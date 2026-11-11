import { execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { chmod, lstat, mkdir, readFile, rename, rm, stat, statfs } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { assertCommit, DIGEST_PATTERN, digestFile, verifyManifest } from './artifact.mjs';
import { extractArchive } from './archive.mjs';
import { activateRelease, currentRelease, recoverPending, rollbackRelease } from './transaction.mjs';
import { verifyOrigin, waitForSearch } from './verification.mjs';

const configPath = '/etc/zsvirt-docs-deploy.json';

function parseCommand(command) {
  const fields = (command ?? '').split(' ');
  if (fields.length === 1 && ['check', 'rollback'].includes(fields[0])) return { action: fields[0] };
  if (fields.length === 5 && fields[0] === 'upgrade') {
    const [, commit, digest, sizeText, bytesText] = fields;
    assertCommit(commit);
    const size = Number(sizeText);
    const totalBytes = Number(bytesText);
    if (!DIGEST_PATTERN.test(digest) || !/^[1-9]\d*$/.test(sizeText) || !/^[1-9]\d*$/.test(bytesText)
      || !Number.isSafeInteger(size) || size > 1024 ** 3 || !Number.isSafeInteger(totalBytes) || totalBytes > 4 * 1024 ** 3) {
      throw new Error('Invalid upload digest or byte limits');
    }
    return { action: 'upgrade', commit, digest, size, totalBytes };
  }
  throw new Error('Only check, upgrade COMMIT SHA256 SIZE TOTAL_BYTES, and rollback are permitted');
}

async function readConfig() {
  const info = await stat(configPath);
  if (info.uid !== 0 || info.mode & 0o022) throw new Error('Deployment config must be root-owned and not writable by group/others');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  if (typeof config.root !== 'string' || !/^\/opt\/[a-zA-Z0-9_-]+$/.test(config.root)
    || config.searchService !== 'zsvirt-doc-search' || !/^[a-z0-9.-]+$/.test(config.siteHost ?? '')) throw new Error('Invalid fixed deployment configuration');
  for (const key of ['origin', 'searchOrigin']) {
    const url = new URL(config[key]);
    if (url.protocol !== 'http:' || config[key] !== url.origin) throw new Error(`Invalid ${key}`);
  }
  return config;
}

async function receiveArchive(path, command) {
  let size = 0;
  const digest = createHash('sha256');
  const bound = new Transform({ transform(chunk, encoding, callback) {
    size += chunk.length;
    if (size > command.size) return callback(new Error('Upload exceeds declared size'));
    digest.update(chunk);
    callback(null, chunk);
  } });
  await pipeline(process.stdin, bound, createWriteStream(path, { flags: 'wx', mode: 0o600 }));
  if (size !== command.size || digest.digest('hex') !== command.digest) throw new Error('Upload size or SHA256 mismatch');
}

async function normalizePermissions(path) {
  const { readdir } = await import('node:fs/promises');
  const info = await lstat(path);
  if (info.isDirectory()) {
    await chmod(path, 0o755);
    for (const entry of await readdir(path)) await normalizePermissions(join(path, entry));
  } else if (info.isFile()) await chmod(path, 0o644);
  else throw new Error('Release contains unsupported filesystem object');
}

async function main() {
  const command = parseCommand(process.env.SSH_ORIGINAL_COMMAND);
  const config = await readConfig();
  const restart = async () => { execFileSync('/usr/bin/sudo', ['-n', '/usr/bin/systemctl', 'restart', config.searchService], { stdio: ['ignore', 'inherit', 'inherit'] }); };
  const verify = async (release) => { await waitForSearch(config, release); return verifyOrigin(config, release); };
  await recoverPending({ root: config.root, restart, verify });
  if (command.action === 'check') {
    const release = await currentRelease(config.root);
    console.log(JSON.stringify({ event: 'checked', currentRelease: release, ...await verify(release) }));
    return;
  }
  // The root-owned launcher holds flock across this entire process, including failure restoration.
  if (command.action === 'rollback') {
    console.log(JSON.stringify(await rollbackRelease({ root: config.root, restart, verify })));
    return;
  }
  const space = await statfs(config.root);
  const required = command.totalBytes + command.size * 2 + 256 * 1024 ** 2;
  if (space.bavail * space.bsize < required) throw new Error('Insufficient disk space; existing releases were retained');
  const attempt = randomUUID();
  const archive = join(config.root, 'incoming', `${command.commit}-${attempt}.tgz`);
  const candidate = join(config.root, 'releases', `.candidate-${attempt}`);
  const release = join(config.root, 'releases', `${command.commit}-${command.digest.slice(0, 16)}`);
  let candidateExists = false;
  try {
    await receiveArchive(archive, command);
    await mkdir(candidate, { mode: 0o700 });
    candidateExists = true;
    await extractArchive(archive, candidate, { maximumBytes: Math.min(4 * 1024 ** 3, command.totalBytes + 32 * 1024 ** 2) });
    const { manifest } = await verifyManifest(candidate, command.commit);
    if (manifest.totalBytes !== command.totalBytes) throw new Error('Uploaded manifest totalBytes mismatch');
    await normalizePermissions(candidate);
    const existing = await lstat(release).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
    if (existing) {
      if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error('Unsafe existing release');
      await verifyManifest(release, command.commit);
      if (await digestFile(join(release, 'release-manifest.json')) !== await digestFile(join(candidate, 'release-manifest.json'))) {
        throw new Error('Immutable release already exists with different bytes');
      }
    } else {
      await rename(candidate, release);
      candidateExists = false;
    }
    console.log(JSON.stringify(await activateRelease({ root: config.root, release, restart, verify,
      receiptData: { archiveSha256: command.digest, sourceRepository: manifest.sourceRepository } })));
  } finally {
    if (candidateExists) await rm(candidate, { recursive: true, force: true });
    await rm(archive, { force: true });
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ event: 'deployment_failed', message: error.message }));
  process.exitCode = 1;
});
