import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { mkdtemp, mkdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { c } from 'tar';
import { assertRelativePath } from '../scripts/deploy/artifact.mjs';
import { inspectArchive } from '../scripts/deploy/archive.mjs';
import { activateRelease, recoverPending, rollbackRelease, switchCurrent } from '../scripts/deploy/transaction.mjs';
import { originResponse, verifyOrigin } from '../scripts/deploy/verification.mjs';

async function sandbox(t) {
  const root = await mkdtemp(join(tmpdir(), 'docs-deploy-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('release paths reject traversal, absolute paths, control characters and platform separators', () => {
  for (const path of ['../outside', '/outside', 'a/../../outside', 'a\\b', 'a\nb', 'a//b', './a']) {
    assert.throws(() => assertRelativePath(path), /Unsafe/);
  }
  assert.equal(assertRelativePath('docs/api-reference/a.html'), 'docs/api-reference/a.html');
});

test('origin verification selects the docs virtual host at a shared IP and port', async (t) => {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ component: request.headers.host === 'docs.example.test' ? 'doc-site' : 'main-site' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const config = { origin: `http://127.0.0.1:${server.address().port}`, siteHost: 'docs.example.test' };
  assert.deepEqual(await (await originResponse(config, '/release-manifest.json')).json(), { component: 'doc-site' });
});

test('archive inspection rejects symlinks before extracting files', async (t) => {
  const root = await sandbox(t);
  await writeFile(join(root, 'release-manifest.json'), '{}');
  await symlink('../outside', join(root, 'escape'));
  const archive = join(root, 'release.tgz');
  await c({ cwd: root, file: archive, gzip: true }, ['release-manifest.json', 'escape']);
  await assert.rejects(inspectArchive(archive), /Unsupported archive entry: SymbolicLink/);
});

test('archive inspection enforces uncompressed release size', async (t) => {
  const root = await sandbox(t);
  await writeFile(join(root, 'release-manifest.json'), '{}');
  await writeFile(join(root, 'payload'), Buffer.alloc(2048));
  const archive = join(root, 'release.tgz');
  await c({ cwd: root, file: archive, gzip: true }, ['release-manifest.json', 'payload']);
  await assert.rejects(inspectArchive(archive, { maximumBytes: 1024 }), /exceeds/);
});

async function releases(t) {
  const root = await sandbox(t);
  const previous = join(root, 'releases', 'previous');
  const next = join(root, 'releases', 'next');
  await mkdir(previous, { recursive: true });
  await mkdir(next);
  await mkdir(join(root, 'deployments'));
  await symlink(previous, join(root, 'current'));
  return { root, previous, next };
}

test('failed acceptance restores both current pointer and running search release', async (t) => {
  const { root, previous, next } = await releases(t);
  const running = [];
  await assert.rejects(activateRelease({ root, release: next,
    restart: async () => running.push(await readlink(join(root, 'current'))),
    verify: async (release) => { if (release === next) throw new Error('snapshot version mismatch'); return { sourceCommit: 'previous' }; },
  }), /previous release restored: snapshot version mismatch/);
  assert.equal(await readlink(join(root, 'current')), previous);
  assert.deepEqual(running, [next, previous]);
  const receiptPath = (await readFile(join(root, 'deployments', 'current-receipt'), 'utf8')).trim();
  assert.equal(JSON.parse(await readFile(receiptPath, 'utf8')).action, 'recovery');
  await assert.rejects(readFile(join(root, 'deployments', 'pending.json')), { code: 'ENOENT' });
});

test('accepted release records an exact rollback and rejects stale receipts', async (t) => {
  const { root, previous, next } = await releases(t);
  const restart = async () => {};
  const verify = async (release) => ({ sourceCommit: release === next ? 'new-commit' : 'previous-commit' });
  const receipt = await activateRelease({ root, release: next, restart, verify });
  assert.equal(receipt.previousRelease, previous);
  assert.equal(receipt.currentRelease, next);
  assert.equal(receipt.sourceCommit, 'new-commit');
  const result = await rollbackRelease({ root, restart, verify });
  assert.equal(result.currentRelease, previous);
  assert.equal(await readlink(join(root, 'current')), previous);
  await writeFile(join(root, 'deployments', 'current-receipt'), receipt.receiptPath);
  await assert.rejects(rollbackRelease({ root, restart, verify }), /does not match/);
});

async function interruptActivation(root, release) {
  const module = new URL('../scripts/deploy/transaction.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { activateRelease } from ${JSON.stringify(module)};
    await activateRelease({ root: ${JSON.stringify(root)}, release: ${JSON.stringify(release)},
      restart: async () => { process.kill(process.pid, 'SIGKILL'); },
      verify: async () => { throw new Error('must not reach acceptance'); } });
  `], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const signal = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => signal ? resolve(signal) : reject(new Error(`Child exited ${code}: ${stderr}`)));
  });
  assert.equal(signal, 'SIGKILL');
}

test('next invocation recovers a process killed after current switched, then retries same release', async (t) => {
  const { root, previous, next } = await releases(t);
  await interruptActivation(root, next);
  assert.equal(await readlink(join(root, 'current')), next);
  const pending = JSON.parse(await readFile(join(root, 'deployments', 'pending.json'), 'utf8'));
  assert.equal(pending.previousRelease, previous);
  const running = [];
  const verified = [];
  const result = await activateRelease({ root, release: next,
    restart: async () => running.push(await readlink(join(root, 'current'))),
    verify: async (release) => { verified.push(release); return {}; } });
  assert.deepEqual(running, [previous, next]);
  assert.deepEqual(verified, [previous, next]);
  assert.equal(result.currentRelease, next);
  assert.equal(result.unchanged, undefined);
  await assert.rejects(readFile(join(root, 'deployments', 'pending.json')), { code: 'ENOENT' });
});

test('same active release is restarted and accepted again while retaining its rollback target', async (t) => {
  const { root, previous, next } = await releases(t);
  let restarts = 0;
  const restart = async () => { restarts++; };
  const verify = async () => ({});
  await activateRelease({ root, release: next, restart, verify });
  const retry = await activateRelease({ root, release: next, restart, verify });
  assert.equal(restarts, 2);
  assert.equal(retry.previousRelease, previous);
  assert.equal(retry.unchanged, undefined);
});

test('recovery failure keeps journal and unknown current drift is never overwritten', async (t) => {
  const { root, previous, next } = await releases(t);
  await interruptActivation(root, next);
  await assert.rejects(recoverPending({ root, restart: async () => { throw new Error('restart failed'); }, verify: async () => ({}) }), /restart failed/);
  const journal = await readFile(join(root, 'deployments', 'pending.json'), 'utf8');
  assert.equal(await readlink(join(root, 'current')), previous);
  const unknown = join(root, 'releases', 'unknown');
  await mkdir(unknown);
  await switchCurrent(root, unknown);
  await assert.rejects(recoverPending({ root, restart: async () => assert.fail('must not restart'), verify: async () => ({}) }), /drift/);
  assert.equal(await readlink(join(root, 'current')), unknown);
  assert.equal(await readFile(join(root, 'deployments', 'pending.json'), 'utf8'), journal);
  await switchCurrent(root, previous);
  await recoverPending({ root, restart: async () => {}, verify: async () => ({}) });
  await assert.rejects(readFile(join(root, 'deployments', 'pending.json')), { code: 'ENOENT' });
});

test('archive size rejection destroys compressed input before reading remaining payload', async (t) => {
  const root = await sandbox(t);
  await writeFile(join(root, 'release-manifest.json'), '{}');
  await writeFile(join(root, 'payload'), randomBytes(1024 * 1024));
  const archive = join(root, 'release.tgz');
  await c({ cwd: root, file: archive, gzip: true }, ['release-manifest.json', 'payload']);
  const bytes = await readFile(archive);
  let consumed = 0;
  const input = new Readable({ highWaterMark: 64, read() {
    const end = Math.min(consumed + 64, bytes.length);
    const chunk = bytes.subarray(consumed, end);
    consumed = end;
    this.push(chunk.length ? chunk : null);
  } });
  await assert.rejects(inspectArchive(input, { maximumBytes: 1024 }), /exceeds/);
  assert.equal(input.destroyed, true);
  assert.ok(consumed < bytes.length / 2, `read ${consumed} of ${bytes.length} compressed bytes`);
});

async function originFixture(t, release, manifest) {
  await mkdir(join(release, '_doc-search'), { recursive: true });
  await writeFile(join(release, 'release-manifest.json'), JSON.stringify(manifest));
  await writeFile(join(release, '_doc-search/runtime.json'), JSON.stringify({ snapshotVersion: 'fixture-version' }));
  let servedManifest = JSON.stringify(manifest);
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/release-manifest.json') return res.end(servedManifest);
    if (url.pathname === '/_doc-search/runtime.json') { res.writeHead(404); return res.end(); }
    if (url.pathname === '/api/search') {
      res.setHeader('x-doc-search-version', 'fixture-version');
      res.setHeader('cache-control', 'no-store');
      const prefix = url.searchParams.get('locale') === 'en' ? '/en/docs' : '/docs';
      return res.end(JSON.stringify([{ type: 'page', url: `${prefix}/api-reference/compute/image-storage/image-storage/query-backup-storage` }]));
    }
    if (url.pathname.endsWith('.txt')) return res.end('1: RSC fixture');
    if (url.pathname.endsWith('.js')) return res.end('console.log("asset")');
    res.end('<html><script src="/_next/static/fixture.js"></script></html>');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return { config: { origin: `http://127.0.0.1:${server.address().port}`, siteHost: 'docs.example.test' },
    serve: (value) => { servedManifest = JSON.stringify(value); } };
}

test('origin rejects same commit and release ID with different manifest bytes', async (t) => {
  const release = await sandbox(t);
  const manifest = { component: 'doc-site', releaseId: 'same', sourceCommit: 'same', sourceRepository: 'zsvirt-docs-site', files: [{ path: 'a', sha256: 'candidate' }] };
  const origin = await originFixture(t, release, manifest);
  origin.serve({ ...manifest, files: [{ path: 'a', sha256: 'stale-build' }] });
  await assert.rejects(verifyOrigin(origin.config, release), /manifest digest mismatch/);
  origin.serve(manifest);
  const identity = await verifyOrigin(origin.config, release);
  assert.match(identity.manifestSha256, /^[a-f0-9]{64}$/);
});

test('recovery accepts migration-era release manifest without sourceRepository', async (t) => {
  const { root, previous, next } = await releases(t);
  const manifest = { component: 'doc-site', sourceCommit: 'old', releaseId: 'old', files: [] };
  const origin = await originFixture(t, previous, manifest);
  await interruptActivation(root, next);
  await recoverPending({ root, restart: async () => {}, verify: (release) => verifyOrigin(origin.config, release) });
  assert.equal(await readlink(join(root, 'current')), previous);
  await assert.rejects(readFile(join(root, 'deployments', 'pending.json')), { code: 'ENOENT' });
});

test('durable committed receipt wins when journal removal was interrupted', async (t) => {
  const { root, previous, next } = await releases(t);
  let pending;
  await activateRelease({ root, release: next, restart: async () => {}, verify: async () => {
    pending = await readFile(join(root, 'deployments', 'pending.json'));
    return {};
  } });
  // Model a power loss where the committed receipt persisted but journal unlink did not.
  await writeFile(join(root, 'deployments', 'pending.json'), pending);
  const running = [];
  const recovery = await recoverPending({ root,
    restart: async () => running.push(await readlink(join(root, 'current'))), verify: async () => ({}) });
  assert.equal(recovery.committed, true);
  assert.deepEqual(running, [next]);
  const receiptPath = (await readFile(join(root, 'deployments', 'current-receipt'), 'utf8')).trim();
  assert.equal(JSON.parse(await readFile(receiptPath, 'utf8')).previousRelease, previous);
  await assert.rejects(readFile(join(root, 'deployments', 'pending.json')), { code: 'ENOENT' });
});
