import { execFileSync, spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { assertCommit, assertSafePath, DIGEST_PATTERN, digestFile, writeBaseManifest } from './deploy/artifact.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [action, ...extra] = process.argv.slice(2).filter((value) => value !== '--');
if (!['prepare', 'check', 'upgrade', 'rollback'].includes(action) || extra.length) throw new Error('Usage: pnpm run deploy -- prepare|check|upgrade|rollback');
const host = process.env.DOCS_DEPLOY_HOST;
const user = process.env.DOCS_DEPLOY_USER;
const port = process.env.DOCS_DEPLOY_PORT || '22';
const key = process.env.DOCS_DEPLOY_KEY_FILE;
const knownHosts = process.env.DOCS_DEPLOY_KNOWN_HOSTS_FILE;
if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host ?? '') || !/^[a-z_][a-z0-9_-]*$/.test(user ?? '')
  || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535 || !key || !knownHosts) {
  throw new Error('Set DOCS_DEPLOY_HOST, USER, PORT, KEY_FILE and KNOWN_HOSTS_FILE explicitly');
}
let command = action === 'prepare' ? 'manifest' : action;
let archive;
if (action === 'upgrade') {
  await assertSafePath(resolve(root, 'artifacts/release.json'));
  const release = JSON.parse(await readFile(resolve(root, 'artifacts/release.json'), 'utf8'));
  assertCommit(release.commit);
  if (release.schemaVersion !== 2 || !DIGEST_PATTERN.test(release.manifestSha256 ?? '')
    || !['full', 'incremental'].includes(release.mode)
    || (release.mode === 'full' ? release.baseManifestSha256 !== null : !DIGEST_PATTERN.test(release.baseManifestSha256 ?? ''))
    || release.archive !== `${release.commit}.tgz` || !DIGEST_PATTERN.test(release.sha256 ?? '')
    || !Number.isSafeInteger(release.size) || release.size <= 0 || !Number.isSafeInteger(release.totalBytes) || release.totalBytes <= 0) {
    throw new Error('Invalid packaged release metadata');
  }
  archive = resolve(root, 'artifacts', release.archive);
  await assertSafePath(archive);
  if ((await stat(archive)).size !== release.size || await digestFile(archive) !== release.sha256) throw new Error('Packaged archive digest mismatch');
  command = `upgrade ${release.commit} ${release.sha256} ${release.size} ${release.totalBytes} ${release.manifestSha256} ${release.baseManifestSha256 ?? 'none'}`;
}
const args = ['-T', '-p', port, '-i', resolve(key), '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes',
  '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${resolve(knownHosts)}`, '-o', 'ConnectTimeout=15',
  '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4', `${user}@${host}`, command];
const child = spawn('ssh', args, { stdio: ['pipe', action === 'prepare' ? 'pipe' : 'inherit', 'inherit'] });
const chunks = [];
let outputBytes = 0;
if (action === 'prepare') child.stdout.on('data', (chunk) => {
  outputBytes += chunk.length;
  if (outputBytes > 32 * 1024 ** 2) child.kill('SIGTERM');
  else chunks.push(chunk);
});
const exited = new Promise((fulfill, reject) => {
  child.once('error', reject);
  child.once('close', (code, signal) => code === 0 ? fulfill() : reject(new Error(`Deployment SSH failed: ${signal || code}`)));
});
try {
  await Promise.all([exited, archive ? pipeline(createReadStream(archive), child.stdin) : Promise.resolve(child.stdin.end())]);
} catch (error) {
  child.kill('SIGTERM');
  throw error;
}
if (action === 'prepare') {
  if (outputBytes > 32 * 1024 ** 2) throw new Error('Remote manifest exceeds size limit');
  const bytes = Buffer.concat(chunks);
  const response = JSON.parse(bytes);
  if (response.status === 'no-current') throw new Error('No current release: bootstrap explicitly with a full release package before prepare; no incremental fallback');
  const { validateManifest } = await import('./deploy/artifact.mjs');
  validateManifest(response);
  const base = await writeBaseManifest(root, bytes);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  execFileSync(process.execPath, [resolve(root, 'scripts/release.mjs'), 'package', '--commit', commit, '--base-manifest', base], { cwd: root, stdio: 'inherit' });
}
