import { createHash } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { c } from 'tar';
import { assertSafePath, DIGEST_PATTERN, digestFile, inventory, validateManifest, verifyManifest } from './artifact.mjs';

export const TRANSFER_FILE = 'release-transfer.json';
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => a && a.size === b.size && a.sha256 === b.sha256;

export async function readBase(path) {
  await assertSafePath(path);
  const bytes = await readFile(path);
  const manifest = JSON.parse(bytes);
  validateManifest(manifest);
  return { manifest, sha256: sha256(bytes) };
}

export function planTransfer(manifest, base = null) {
  validateManifest(manifest);
  const previous = base ? validateManifest(base.manifest) : new Map();
  if (base && !DIGEST_PATTERN.test(base.sha256)) throw new Error('Invalid base manifest SHA256');
  return { schemaVersion: 2, mode: base ? 'incremental' : 'full', baseManifestSha256: base?.sha256 ?? null,
    changedFiles: manifest.files.filter((file) => !same(previous.get(file.path), file)).map((file) => file.path) };
}

export function transferMetrics(manifest, transfer, uploadBytes) {
  const changed = new Set(transfer.changedFiles);
  const domains = {};
  for (const file of manifest.files) {
    const localized = file.path.replace(/^en\//, '');
    const parts = localized.split('/');
    const section = (parts[1] ?? 'index').replace(/\.[^.]+$/, '');
    const area = (parts[2] ?? 'index').replace(/\.[^.]+$/, '');
    const domain = file.path.startsWith('_next/') ? 'next-assets' : file.path.startsWith('_doc-search/') ? 'search-runtime'
      : localized === 'docs/search-index.json' ? 'search-index'
        : parts[0] === 'docs' ? `docs/${section}${section === 'api-reference' ? `/${area}` : ''}`
          : /^docs\./.test(localized) ? 'docs/index' : 'other';
    const item = domains[domain] ??= { totalBytes: 0, changedBytes: 0, changedFiles: 0, reusedFiles: 0 };
    item.totalBytes += file.size;
    if (changed.has(file.path)) { item.changedBytes += file.size; item.changedFiles++; } else item.reusedFiles++;
  }
  return { totalBytes: manifest.totalBytes, changedFiles: changed.size, reusedFiles: manifest.fileCount - changed.size, uploadBytes, domains };
}

export async function packageTransfer(source, archive, base = null) {
  const { manifest } = await verifyManifest(source);
  const transfer = planTransfer(manifest, base);
  transfer.targetManifestSha256 = await digestFile(join(source, 'release-manifest.json'));
  // The control file is temporary and never becomes part of the built site's manifest.
  const control = join(source, TRANSFER_FILE);
  await writeFile(control, `${JSON.stringify(transfer)}\n`, { flag: 'wx', mode: 0o644 });
  try {
    await c({ cwd: source, file: archive, gzip: true, portable: true, noDirRecurse: true },
      ['release-manifest.json', TRANSFER_FILE, ...transfer.changedFiles]);
  } finally { await rm(control); }
  return { manifest, transfer };
}

export async function materializeTransfer(candidate, baseRoot, identity) {
  await assertSafePath(join(candidate, TRANSFER_FILE));
  await assertSafePath(join(candidate, 'release-manifest.json'));
  const transfer = JSON.parse(await readFile(join(candidate, TRANSFER_FILE), 'utf8'));
  const targetBytes = await readFile(join(candidate, 'release-manifest.json'));
  const manifest = JSON.parse(targetBytes);
  const target = validateManifest(manifest, identity.commit);
  if (transfer.schemaVersion !== 2 || !['full', 'incremental'].includes(transfer.mode)
    || transfer.targetManifestSha256 !== sha256(targetBytes) || transfer.targetManifestSha256 !== identity.manifestSha256
    || transfer.baseManifestSha256 !== identity.baseManifestSha256
    || manifest.totalBytes !== identity.totalBytes || !Array.isArray(transfer.changedFiles)) throw new Error('Invalid transfer identity');
  let base = null;
  if (transfer.mode === 'incremental') {
    if (!baseRoot) throw new Error('Incremental release requires current release');
    base = await readBase(join(baseRoot, 'release-manifest.json'));
    if (base.sha256 !== transfer.baseManifestSha256) throw new Error('Base manifest mismatch; prepare again');
  } else if (transfer.baseManifestSha256 !== null) throw new Error('Full transfer must not declare a base');
  const expectedPlan = planTransfer(manifest, base);
  if (JSON.stringify(transfer.changedFiles) !== JSON.stringify(expectedPlan.changedFiles)) throw new Error('Transfer changed file set mismatch');
  const expected = new Set(['release-manifest.json', TRANSFER_FILE, ...transfer.changedFiles]);
  const actual = await inventory(candidate);
  if (actual.length !== expected.size || actual.some((file) => !expected.has(file.path))) throw new Error('Unlisted or missing transfer files');
  const directories = new Set();
  for (const path of expected) {
    let parent = dirname(path);
    while (parent !== '.') { directories.add(parent); parent = dirname(parent); }
  }
  async function checkDirectories(relative = '') {
    for (const entry of await readdir(join(candidate, relative), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (!directories.has(path)) throw new Error(`Unlisted transfer directory: ${path}`);
      await checkDirectories(path);
    }
  }
  await checkDirectories();
  const changed = new Set(transfer.changedFiles);
  for (const file of target.values()) {
    if (changed.has(file.path)) continue;
    const source = join(baseRoot, file.path);
    await assertSafePath(source);
    const destination = join(candidate, file.path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(source, destination);
  }
  await rm(join(candidate, TRANSFER_FILE));
  await verifyManifest(candidate, identity.commit);
  return { manifest, transfer, metrics: transferMetrics(manifest, transfer, identity.size) };
}
