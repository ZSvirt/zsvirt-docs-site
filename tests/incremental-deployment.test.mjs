import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, readlink, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { c } from 'tar';
import { createManifest, digestFile, verifyManifest, writeBaseManifest } from '../scripts/deploy/artifact.mjs';
import { extractArchive } from '../scripts/deploy/archive.mjs';
import { materializeTransfer, packageTransfer, readBase } from '../scripts/deploy/transfer.mjs';
import { activateRelease, rollbackRelease } from '../scripts/deploy/transaction.mjs';

const commit = 'a'.repeat(40);
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'incremental-docs-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'releases'));
  await mkdir(join(root, 'deployments'));
  async function site(name, extra = {}) {
    const directory = join(root, 'releases', name);
    const files = { 'docs.html': '中文', 'en/docs.html': 'English', 'docs.txt': 'RSC', 'en/docs.txt': 'RSC en',
      'docs/search-index.json': JSON.stringify({ version: 'b'.repeat(64) }), '_doc-search/server.mjs': 'server',
      '_doc-search/THIRD-PARTY-LICENSES.txt': 'licenses', 'docs/keep.html': 'keep', ...extra };
    for (const [path, bytes] of Object.entries(files)) {
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), bytes);
    }
    await writeFile(join(directory, '_doc-search/runtime.json'), JSON.stringify({ sourceCommit: commit, snapshotVersion: 'b'.repeat(64),
      bundleSha256: await digestFile(join(directory, '_doc-search/server.mjs')),
      licensesSha256: await digestFile(join(directory, '_doc-search/THIRD-PARTY-LICENSES.txt')) }));
    await createManifest(directory, commit);
    return directory;
  }
  const previous = await site('previous', { 'deleted.html': 'gone' });
  const target = await site('target', { 'docs.html': 'changed' });
  await symlink(previous, join(root, 'current'));
  const base = await readBase(join(previous, 'release-manifest.json'));
  const archive = join(root, 'release.tgz');
  const { manifest, transfer } = await packageTransfer(target, archive, base);
  const identity = { commit, manifestSha256: transfer.targetManifestSha256, baseManifestSha256: base.sha256,
    totalBytes: manifest.totalBytes, size: (await stat(archive)).size };
  async function candidate(name = 'candidate') {
    const path = join(root, 'releases', name);
    await mkdir(path);
    await extractArchive(archive, path);
    return path;
  }
  return { root, previous, target, base, archive, manifest, transfer, identity, candidate };
}

test('single changed file ships alone; deleted files disappear; copies isolate rollback releases', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(f.transfer.changedFiles, ['docs.html']);
  const next = await f.candidate();
  const result = await materializeTransfer(next, f.previous, f.identity);
  assert.equal(result.metrics.changedFiles, 1);
  assert.equal(result.metrics.reusedFiles, f.manifest.fileCount - 1);
  assert.equal(result.metrics.uploadBytes, f.identity.size);
  assert.equal(result.metrics.domains['docs/index'].changedFiles, 1);
  assert.equal(result.metrics.domains['search-index'].reusedFiles, 1);
  await assert.rejects(stat(join(next, 'deleted.html')), { code: 'ENOENT' });
  assert.notEqual((await stat(join(next, 'docs/keep.html'))).ino, (await stat(join(f.previous, 'docs/keep.html'))).ino);
  await activateRelease({ root: f.root, release: next, restart: async () => {}, verify: verifyManifest });
  await writeFile(join(next, 'docs/keep.html'), 'candidate mutation');
  assert.equal(await readFile(join(f.previous, 'docs/keep.html'), 'utf8'), 'keep');
  await rollbackRelease({ root: f.root, restart: async () => {}, verify: verifyManifest });
  assert.equal(await readlink(join(f.root, 'current')), f.previous);
});

test('explicit full package reconstructs without a base', async (t) => {
  const f = await fixture(t);
  const { transfer } = await packageTransfer(f.target, f.archive);
  assert.equal(transfer.mode, 'full');
  assert.equal(transfer.baseManifestSha256, null);
  const next = await f.candidate();
  const result = await materializeTransfer(next, null, { ...f.identity, baseManifestSha256: null });
  assert.equal(result.metrics.reusedFiles, 0);
  await verifyManifest(next, commit);
});

for (const scenario of ['base mismatch', 'reuse tampered', 'unlisted file', 'unlisted directory', 'symlink reuse', 'changed file tampered', 'target identity', 'missing base']) {
  test(`${scenario} rejects before switching current`, async (t) => {
    const f = await fixture(t);
    const next = await f.candidate();
    let baseRoot = f.previous;
    let expected;
    if (scenario === 'base mismatch') {
      await writeFile(join(f.previous, 'release-manifest.json'), `${await readFile(join(f.previous, 'release-manifest.json'), 'utf8')}\n`);
      expected = /Base manifest mismatch/;
    } else if (scenario === 'reuse tampered') {
      await writeFile(join(f.previous, 'docs/keep.html'), 'corrupt'); expected = /digest mismatch/;
    } else if (scenario === 'unlisted file') {
      await writeFile(join(next, 'evil.html'), 'evil');
      // Exercise actual archive extraction, not merely the manifest comparison.
      const malicious = join(f.root, 'malicious.tgz');
      await c({ cwd: next, file: malicious, gzip: true }, ['.']);
      const extracted = join(f.root, 'malicious'); await mkdir(extracted);
      await extractArchive(malicious, extracted);
      await assert.rejects(materializeTransfer(extracted, baseRoot, f.identity), /Unlisted/);
      expected = /Unlisted/;
    } else if (scenario === 'unlisted directory') {
      await mkdir(join(next, 'evil')); expected = /Unlisted transfer directory/;
    } else if (scenario === 'symlink reuse') {
      await rm(join(f.previous, 'docs/keep.html'));
      await symlink(join(f.target, 'docs/keep.html'), join(f.previous, 'docs/keep.html')); expected = /Unsafe filesystem path/;
    } else if (scenario === 'changed file tampered') {
      await writeFile(join(next, 'docs.html'), 'corrupt'); expected = /digest mismatch/;
    } else if (scenario === 'target identity') {
      f.identity.manifestSha256 = '0'.repeat(64); expected = /Invalid transfer identity/;
    } else { baseRoot = null; expected = /requires current/; }
    await assert.rejects(materializeTransfer(next, baseRoot, f.identity), expected);
    assert.equal(await readlink(join(f.root, 'current')), f.previous);
    await assert.rejects(stat(join(f.root, 'deployments/pending.json')), { code: 'ENOENT' });
  });
}

test('incremental candidate acceptance failure retains original rollback contract', async (t) => {
  const f = await fixture(t);
  const next = await f.candidate();
  await materializeTransfer(next, f.previous, f.identity);
  await assert.rejects(activateRelease({ root: f.root, release: next, restart: async () => {},
    verify: async (path) => { if (path === next) throw new Error('origin rejected'); await verifyManifest(path); } }), /previous release restored/);
  assert.equal(await readlink(join(f.root, 'current')), f.previous);
});

for (const kind of ['file', 'directory']) {
  test(`prepare baseline writer rejects ${kind} symlink without modifying its target`, async (t) => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'baseline-write-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    const outside = join(root, 'outside');
    await mkdir(outside);
    const protectedFile = join(outside, 'base-manifest.json');
    await writeFile(protectedFile, 'original bytes');
    const artifacts = join(root, 'artifacts');
    if (kind === 'directory') await symlink(outside, artifacts);
    else {
      await mkdir(artifacts);
      await symlink(protectedFile, join(artifacts, 'base-manifest.json'));
    }
    await assert.rejects(writeBaseManifest(root, Buffer.from('replacement bytes')), /Unsafe/);
    assert.equal(await readFile(protectedFile, 'utf8'), 'original bytes');
    assert.deepEqual(await readdir(outside), ['base-manifest.json']);
    assert.deepEqual(await readdir(artifacts), ['base-manifest.json']);
    assert.equal(await readlink(kind === 'directory' ? artifacts : join(artifacts, 'base-manifest.json')),
      kind === 'directory' ? outside : protectedFile);
  });
}

test('prepare baseline writer atomically replaces regular files and preserves exact response bytes', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'baseline-write-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = await writeBaseManifest(root, Buffer.from('first'));
  const original = await stat(path);
  const bytes = Buffer.from('{"files":[]}\n\n');
  assert.equal(await writeBaseManifest(root, bytes), path);
  assert.deepEqual(await readFile(path), bytes);
  assert.notEqual((await stat(path)).ino, original.ino);
  assert.deepEqual(await readdir(join(root, 'artifacts')), ['base-manifest.json']);
});
