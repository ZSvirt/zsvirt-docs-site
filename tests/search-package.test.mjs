import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createSnapshot } from '../search-runtime/snapshot.mjs';
import { hostFrom } from '../search-runtime/server.mjs';
import { packageSearch } from '../scripts/package-search.mjs';

const records = [
  { id: 'zh:backup', locale: 'zh', url: '/docs/api-reference/compute/image-storage/image-storage/query-backup-storage', title: '查询镜像存储', structuredData: { headings: [], contents: [{ content: 'QueryBackupStorage\nGET /zstack/v1/backup-storage\n/v1/backup-storage' }] } },
  { id: 'en:backup', locale: 'en', url: '/en/docs/api-reference/compute/image-storage/image-storage/query-backup-storage', title: 'Query Backup Storage', structuredData: { headings: [], contents: [{ content: 'QueryBackupStorage\nGET /zstack/v1/backup-storage\n/v1/backup-storage' }] } },
  { id: 'zh:login', locale: 'zh', url: '/docs/user-guide/getting-started/login', title: '登录', structuredData: { headings: [], contents: [{ content: '默认初始密码：**admin**。' }] } },
  { id: 'zh:create-vm', locale: 'zh', url: '/docs/api-reference/compute/vm/create-vm-instance', title: '新建虚拟机', structuredData: { headings: [], contents: [{ content: 'POST /zstack/v1/vm-instances\n/v1/vm-instances' }] } },
];

test('search runtime host is loopback or a specific RFC1918 IPv4 address', () => {
  for (const host of ['127.0.0.1', '::1', '10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.1']) {
    assert.equal(hostFrom(host), host);
  }
  for (const host of ['0.0.0.0', '127.0.0.2', '10.0.0.256', '172.15.0.1', '172.32.0.1', '192.169.1.1', '8.8.8.8', 'example.com', '::']) {
    assert.throws(() => hostFrom(host), /RFC1918/);
  }
});

test('bundled runtime checks an isolated bilingual snapshot without node_modules or a listening port', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'doc-search-package-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const release = join(directory, 'release');
  const outputDirectory = join(release, '_doc-search');
  const snapshotPath = join(release, 'docs', 'search-index.json');
  await mkdir(join(release, 'docs'), { recursive: true });
  const snapshot = createSnapshot(records);
  await writeFile(snapshotPath, JSON.stringify(snapshot));
  const metadata = await packageSearch({ snapshotPath, outputDirectory, sourceCommit: undefined });
  const bundlePath = join(outputDirectory, 'server.mjs');
  const bundle = await readFile(bundlePath);
  const licenses = await readFile(join(outputDirectory, 'THIRD-PARTY-LICENSES.txt'), 'utf8');
  assert.equal(metadata.bundleSha256, createHash('sha256').update(bundle).digest('hex'));
  assert.equal(metadata.licensesSha256, createHash('sha256').update(licenses).digest('hex'));
  assert.match(licenses, /@orama\/orama@3\.1\.18/);
  assert.match(licenses, /Declared license: Apache-2\.0/);
  assert.match(bundle.toString('utf8', 0, 180), /THIRD-PARTY-LICENSES\.txt/);
  assert.equal(metadata.snapshotVersion, snapshot.version);
  assert.equal(metadata.minimumNodeMajor, 22);
  assert.ok(!Object.hasOwn(metadata, 'sourceCommit'));
  assert.deepEqual(JSON.parse(await readFile(join(outputDirectory, 'runtime.json'), 'utf8')), metadata);
  assert.ok(!bundle.toString().includes(process.cwd()));
  await assert.rejects(packageSearch({ snapshotPath, outputDirectory, sourceCommit: 'dirty' }), /full Git SHA/);
  const attested = await packageSearch({ snapshotPath, outputDirectory: join(release, '_doc-search-attested'), sourceCommit: 'A'.repeat(40) });
  assert.equal(attested.sourceCommit, 'a'.repeat(40));

  const env = { ...process.env, DOC_SEARCH_SNAPSHOT: snapshotPath, DOC_SEARCH_HOST: '0.0.0.0', NODE_PATH: '' };
  const check = spawnSync(process.execPath, [bundlePath, '--check-snapshot'], { cwd: directory, env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stdout, /"event":"snapshot_checked"/);
  assert.match(check.stdout, new RegExp(snapshot.version));
  assert.ok(!check.stdout.includes('"event":"listening"'));

  const unknown = spawnSync(process.execPath, [bundlePath, '--unknown'], { cwd: directory, env, encoding: 'utf8', timeout: 10_000 });
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown search runtime argument/);
  const extra = spawnSync(process.execPath, [bundlePath, '--check-snapshot', '--unknown'], { cwd: directory, env, encoding: 'utf8', timeout: 10_000 });
  assert.equal(extra.status, 1);

  await writeFile(snapshotPath, JSON.stringify(createSnapshot(records.filter((record) => record.id !== 'zh:login'))));
  const missingPage = spawnSync(process.execPath, [bundlePath, '--check-snapshot'], { cwd: directory, env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(missingPage.status, 1);
  assert.match(missingPage.stderr, /expected page missing/);
});
