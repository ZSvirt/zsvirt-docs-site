import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const SOURCE_REPOSITORY = 'https://github.com/ZSvirt/zsvirt-docs-site';
export const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
export const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

export function assertCommit(commit) {
  if (!COMMIT_PATTERN.test(commit ?? '')) throw new Error('A full lowercase Git commit SHA is required');
  return commit;
}

export function assertRelativePath(path) {
  if (typeof path !== 'string' || !path || /[\\\x00-\x1f\x7f]/.test(path)
    || path.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`Unsafe artifact path: ${JSON.stringify(path)}`);
  }
  return path;
}

export async function digestFile(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

export async function inventory(root) {
  await assertSafePath(root, true);
  const files = [];
  async function visit(directory, prefix = '') {
    for (const name of (await readdir(directory)).sort()) {
      const relative = prefix ? `${prefix}/${name}` : name;
      assertRelativePath(relative);
      const path = join(directory, name);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) throw new Error(`Artifact contains a symbolic link: ${relative}`);
      if (stat.isDirectory()) await visit(path, relative);
      else if (stat.isFile()) files.push({ path: relative, size: stat.size, sha256: await digestFile(path) });
      else throw new Error(`Artifact contains a non-regular entry: ${relative}`);
    }
  }
  await visit(root);
  return files;
}

export async function createManifest(root, commit) {
  assertCommit(commit);
  const files = (await inventory(root)).filter((file) => file.path !== 'release-manifest.json');
  if (!files.length) throw new Error('Cannot package an empty release');
  const manifest = {
    schemaVersion: 1,
    component: 'doc-site',
    sourceRepository: SOURCE_REPOSITORY,
    sourceCommit: commit,
    releaseId: commit,
    generatedAt: new Date().toISOString(),
    files,
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.size, 0),
  };
  await writeFile(join(root, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  await verifyManifest(root, commit);
  return manifest;
}

export function validateManifest(manifest, expectedCommit) {
  assertCommit(manifest.sourceCommit);
  if (manifest.schemaVersion !== 1 || manifest.component !== 'doc-site'
    || manifest.sourceRepository !== SOURCE_REPOSITORY || manifest.releaseId !== manifest.sourceCommit
    || (expectedCommit && manifest.sourceCommit !== expectedCommit)
    || !Number.isFinite(Date.parse(manifest.generatedAt))) throw new Error('Invalid documentation release identity');
  if (!Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length !== manifest.fileCount) {
    throw new Error('Invalid release file count');
  }
  const expected = new Map();
  for (const file of manifest.files) {
    assertRelativePath(file.path);
    if (['release-manifest.json', 'release-transfer.json'].includes(file.path) || expected.has(file.path)
      || !Number.isSafeInteger(file.size) || file.size < 0 || !DIGEST_PATTERN.test(file.sha256 ?? '')) {
      throw new Error(`Invalid manifest entry: ${file.path}`);
    }
    expected.set(file.path, file);
  }
  const total = manifest.files.reduce((sum, file) => sum + file.size, 0);
  if (!Number.isSafeInteger(total) || total !== manifest.totalBytes) throw new Error('Release totalBytes mismatch');
  return expected;
}

export async function assertSafePath(path, directory = false) {
  const absolute = resolve(path);
  const parts = absolute.split('/').filter(Boolean);
  let current = '/';
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]);
    const info = await lstat(current);
    if (info.isSymbolicLink() || (index < parts.length - 1 || directory ? !info.isDirectory() : !info.isFile())) {
      throw new Error(`Unsafe filesystem path: ${current}`);
    }
  }
}

export async function writeBaseManifest(root, bytes) {
  await assertSafePath(root, true);
  const directory = join(root, 'artifacts');
  try { await mkdir(directory); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await assertSafePath(directory, true);
  const destination = join(directory, 'base-manifest.json');
  async function checkDestination() {
    const info = await lstat(destination).catch((error) => { if (error.code === 'ENOENT') return null; throw error; });
    if (info && !info.isFile()) throw new Error(`Unsafe baseline destination: ${destination}`);
  }
  await checkDestination();
  const temporary = join(directory, `.base-manifest-${randomUUID()}.tmp`);
  const handle = await open(temporary, 'wx', 0o600);
  let renamed = false;
  try {
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await assertSafePath(directory, true);
    await checkDestination();
    await rename(temporary, destination);
    renamed = true;
  } finally {
    if (!renamed) await unlink(temporary);
  }
  return destination;
}

export async function verifyManifest(root, expectedCommit) {
  await assertSafePath(join(root, 'release-manifest.json'));
  const manifest = JSON.parse(await readFile(join(root, 'release-manifest.json'), 'utf8'));
  const expected = validateManifest(manifest, expectedCommit);
  const actual = (await inventory(root)).filter((file) => file.path !== 'release-manifest.json');
  if (actual.length !== expected.size) throw new Error('Unlisted or missing release files');
  let total = 0;
  for (const file of actual) {
    const entry = expected.get(file.path);
    if (!entry || file.size !== entry.size || file.sha256 !== entry.sha256) throw new Error(`Release digest mismatch: ${file.path}`);
    total += file.size;
  }
  if (total !== manifest.totalBytes) throw new Error('Release totalBytes mismatch');
  for (const required of ['docs.html', 'en/docs.html', 'docs.txt', 'en/docs.txt', 'docs/search-index.json', '_doc-search/server.mjs', '_doc-search/runtime.json', '_doc-search/THIRD-PARTY-LICENSES.txt']) {
    if (!expected.has(required)) throw new Error(`Required release file missing: ${required}`);
  }
  const metadata = JSON.parse(await readFile(resolve(root, '_doc-search/runtime.json'), 'utf8'));
  const snapshot = JSON.parse(await readFile(resolve(root, 'docs/search-index.json'), 'utf8'));
  if (metadata.sourceCommit !== manifest.sourceCommit || metadata.snapshotVersion !== snapshot.version
    || !DIGEST_PATTERN.test(metadata.snapshotVersion ?? '')
    || metadata.bundleSha256 !== expected.get('_doc-search/server.mjs').sha256
    || metadata.licensesSha256 !== expected.get('_doc-search/THIRD-PARTY-LICENSES.txt').sha256) {
    throw new Error('Search bundle, snapshot and release must have matching identities');
  }
  return { manifest, metadata };
}
