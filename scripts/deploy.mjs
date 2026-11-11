import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { assertCommit, DIGEST_PATTERN, digestFile } from './deploy/artifact.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const [action, ...extra] = process.argv.slice(2).filter((value) => value !== '--');
if (!['check', 'upgrade', 'rollback'].includes(action) || extra.length) throw new Error('Usage: pnpm run deploy -- check|upgrade|rollback');
const host = process.env.DOCS_DEPLOY_HOST;
const user = process.env.DOCS_DEPLOY_USER;
const port = process.env.DOCS_DEPLOY_PORT || '22';
const key = process.env.DOCS_DEPLOY_KEY_FILE;
const knownHosts = process.env.DOCS_DEPLOY_KNOWN_HOSTS_FILE;
if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/.test(host ?? '') || !/^[a-z_][a-z0-9_-]*$/.test(user ?? '')
  || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535 || !key || !knownHosts) {
  throw new Error('Set DOCS_DEPLOY_HOST, USER, PORT, KEY_FILE and KNOWN_HOSTS_FILE explicitly');
}
let command = action;
let archive;
if (action === 'upgrade') {
  const release = JSON.parse(await readFile(resolve(root, 'artifacts/release.json'), 'utf8'));
  assertCommit(release.commit);
  if (release.archive !== `${release.commit}.tgz` || !DIGEST_PATTERN.test(release.sha256 ?? '')
    || !Number.isSafeInteger(release.size) || release.size <= 0 || !Number.isSafeInteger(release.totalBytes) || release.totalBytes <= 0) {
    throw new Error('Invalid packaged release metadata');
  }
  archive = resolve(root, 'artifacts', release.archive);
  if ((await stat(archive)).size !== release.size || await digestFile(archive) !== release.sha256) throw new Error('Packaged archive digest mismatch');
  command = `upgrade ${release.commit} ${release.sha256} ${release.size} ${release.totalBytes}`;
}
const args = ['-T', '-p', port, '-i', resolve(key), '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes',
  '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${resolve(knownHosts)}`, '-o', 'ConnectTimeout=15',
  '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4', `${user}@${host}`, command];
const child = spawn('ssh', args, { stdio: ['pipe', 'inherit', 'inherit'] });
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
