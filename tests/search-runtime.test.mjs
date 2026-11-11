import assert from 'node:assert/strict';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createSnapshot, parseSnapshot } from '../search-runtime/snapshot.mjs';
import { createSearchEngine } from '../search-runtime/engine.mjs';
import { startSearchServer } from '../search-runtime/server.mjs';

const records = [
  {
    id: 'guide:zh:search', locale: 'zh', url: '/docs/user-guide/search', title: '全局搜索',
    breadcrumbs: ['用户手册'],
    structuredData: {
      headings: [{ id: 'chinese-search', content: '中文文档检索' }],
      contents: [{ heading: 'chinese-search', content: '虚拟化平台支持快速检索和 virtualization。' }],
    },
  },
  {
    id: 'guide:en:search', locale: 'en', url: '/en/docs/user-guide/search', title: 'Global search',
    structuredData: { headings: [], contents: [{ content: 'The hypervisor supports virtualization.' }] },
  },
  {
    id: 'api:zh:volume-1', locale: 'zh', url: '/docs/api-reference/volume-1', title: '查询卷',
    structuredData: { headings: [{ id: 'request', content: 'GET /v1/volumes/1' }], contents: [] },
  },
  {
    id: 'api:zh:volume-10', locale: 'zh', url: '/docs/api-reference/volume-10', title: '查询卷',
    structuredData: { headings: [{ id: 'request', content: 'GET /v1/volumes/10' }], contents: [] },
  },
];

test('snapshot has a deterministic checksum and rejects invalid documents', () => {
  const snapshot = createSnapshot(records);
  assert.deepEqual(snapshot, createSnapshot([...records].reverse()));
  assert.deepEqual(parseSnapshot(JSON.stringify(snapshot)), snapshot);
  assert.throws(() => parseSnapshot({ ...snapshot, version: '0'.repeat(64) }), /checksum mismatch/);
  assert.throws(() => parseSnapshot({ ...snapshot, schemaVersion: 2 }), /unsupported schema version/);
  assert.throws(() => createSnapshot(records.map((item, index) => index === 0 ? { ...item, url: 'https://example.com/docs' } : item)), /local zh docs path/);
  assert.throws(() => createSnapshot(records.map((item, index) => index === 0 ? { ...item, structuredData: { headings: [], contents: [{ heading: 'missing', content: 'x' }] } } : item)), /unknown heading/);
  assert.throws(() => createSnapshot([...records, { ...records[0], id: 'guide:zh:search-0', url: '/docs/child' }]), /generated search document IDs collide/);
});

test('HTTP search uses isolated language indexes and fails closed after a broken reload', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'doc-search-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const snapshotPath = join(directory, 'search-index.json');
  await writeFile(snapshotPath, JSON.stringify(createSnapshot(records)));
  const events = [];
  const app = await startSearchServer({ snapshotPath, port: 0, logger: { info: (event) => events.push(event), error: (event) => events.push(event) } });
  context.after(() => app.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const request = (query, locale) => fetch(`${base}/api/search?query=${encodeURIComponent(query)}&locale=${locale}`);

  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200, JSON.stringify(events));
  assert.deepEqual((await health.json()).counts, { zh: 3, en: 1 });
  const readyEvent = events.find((event) => event.event === 'snapshot_ready');
  assert.ok(Number.isFinite(readyEvent.elapsedMs) && readyEvent.elapsedMs >= 0);
  assert.ok(readyEvent.processRssBytes > 0);
  assert.ok(readyEvent.processHeapUsedBytes > 0);

  const zhResponse = await request('中文文档检索', 'zh');
  assert.equal(zhResponse.status, 200);
  assert.ok((await zhResponse.json()).some((item) => item.url === '/docs/user-guide/search#chinese-search'));
  const enResponse = await request('virtualization', 'en');
  assert.equal(enResponse.status, 200);
  const enResults = await enResponse.json();
  assert.ok(enResults.some((item) => item.url === '/en/docs/user-guide/search'));
  assert.ok(enResults.every((item) => item.url.startsWith('/en/docs/')));
  const requestId = enResponse.headers.get('x-request-id');
  assert.match(requestId, /^[a-f0-9-]{36}$/);
  assert.ok(events.some((event) => event.event === 'search_request_complete' && event.requestId === requestId && event.locale === 'en' && event.resultCount === enResults.length && event.status === 200 && event.elapsedMs >= 0));

  const apiResponse = await request('GET /v1/volumes', 'zh');
  assert.equal(apiResponse.status, 200);
  const apiResults = await apiResponse.json();
  assert.ok(apiResults.some((item) => item.id.startsWith('api:zh:volume-1-')));
  assert.ok(apiResults.some((item) => item.id.startsWith('api:zh:volume-10-')));
  assert.ok(apiResults.length <= 20);

  for (const url of [
    `${base}/api/search?query=x&locale=fr`,
    `${base}/api/search?query=x&locale=zh&limit=100`,
    `${base}/api/search?query=x&locale=zh&tag=api`,
    `${base}/api/search?query=x&query=y&locale=zh`,
    `${base}/api/search?query=x&locale=zh&locale=en`,
    `${base}/api/search?query=${'x'.repeat(201)}&locale=zh`,
    `${base}/api/search?locale=zh`,
  ]) {
    const response = await fetch(url);
    assert.equal(response.status, 400, url);
    assert.ok((await response.json()).error.code);
  }
  assert.deepEqual(await (await request('', 'zh')).json(), []);
  const methodResponse = await fetch(`${base}/api/search?query=x&locale=zh`, { method: 'POST' });
  assert.equal(methodResponse.status, 405);
  assert.equal(methodResponse.headers.get('allow'), 'GET');
  assert.ok(events.some((event) => event.event === 'search_request_complete' && event.errorCode === 'INVALID_REQUEST' && event.status === 400));

  const replacement = join(directory, 'replacement.json');
  await writeFile(replacement, '{broken');
  await rename(replacement, snapshotPath);
  await assert.rejects(app.runtime.reload(), /JSON is malformed/);
  const failedHealth = await fetch(`${base}/health`);
  assert.equal(failedHealth.status, 503);
  assert.equal((await failedHealth.json()).ready, false);
  const failedSearch = await request('virtualization', 'en');
  assert.equal(failedSearch.status, 503);
  assert.equal((await failedSearch.json()).error.code, 'SEARCH_UNAVAILABLE');
  assert.ok(events.some((event) => event.event === 'search_request_complete' && event.errorCode === 'SEARCH_UNAVAILABLE' && event.status === 503));
  assert.ok(events.some((event) => event.event === 'snapshot_load_failed'));
  assert.ok(events.every((event) => !JSON.stringify(event).includes('virtualization')));

  const restored = createSnapshot(records.map((record) => record.id === 'guide:en:search' ? { ...record, title: 'Updated search' } : record));
  await writeFile(replacement, JSON.stringify(restored));
  await rename(replacement, snapshotPath);
  let recovered = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((fulfill) => setTimeout(fulfill, 25));
    const state = await (await fetch(`${base}/health`)).json();
    if (state.ready && state.version === restored.version) {
      recovered = true;
      break;
    }
  }
  assert.equal(recovered, true, 'atomic snapshot replacement should reload the index');
});

test('field ranking favors matching titles and HTTP endpoints while preserving safe, bounded excerpts', async () => {
  const zh = [
    { id: 'zh:vm:create', locale: 'zh', url: '/docs/api-reference/create-vm', title: '新建虚拟机', structuredData: { headings: [], contents: [{ content: 'POST /zstack/v1/vm-instances\n/v1/vm-instances\n新建虚拟机的请求参数。' }] } },
    { id: 'zh:vm:stop', locale: 'zh', url: '/docs/api-reference/stop-vm', title: '虚拟机关机', structuredData: { headings: [], contents: [{ content: `虚拟机UUID 创建时间 ${'虚拟机 创建时间 '.repeat(80)}` }] } },
    { id: 'zh:vm:created', locale: 'zh', url: '/docs/api-reference/create-vm-backup', title: '创建虚拟机备份', structuredData: { headings: [], contents: [] } },
    { id: 'zh:api:backup', locale: 'zh', url: '/docs/api-reference/query-backup-storage', title: '查询镜像存储', structuredData: { headings: [{ id: 'request', content: '请求地址' }], contents: [{ heading: 'request', content: 'GET /zstack/v1/backup-storage\n/v1/backup-storage\n查询接口。' }] } },
    { id: 'zh:api:noise', locale: 'zh', url: '/docs/api-reference/database-backup', title: '查询数据库备份', structuredData: { headings: [], contents: [{ content: '数据库备份正文提到 v1 backup storage，但不是该接口。' }] } },
    { id: 'zh:unsafe', locale: 'zh', url: '/docs/api-reference/unsafe', title: '诊断示例', structuredData: { headings: [], contents: [{ content: '`<img src="x" onerror="alert(1)">` "quoted" & ' + 'x'.repeat(1_200) + ' needle-at-tail' }] } },
  ];
  const en = [
    { id: 'en:vm', locale: 'en', url: '/en/docs/virtual-machine', title: 'Virtual Machine Guide', structuredData: { headings: [], contents: [] } },
    { id: 'en:network', locale: 'en', url: '/en/docs/virtual-network', title: 'Virtual Network', structuredData: { headings: [], contents: [{ content: 'A machine appears in a separate paragraph.' }] } },
  ];
  const zhEngine = await createSearchEngine(zh, 'zh');
  const enEngine = await createSearchEngine(en, 'en');
  const pages = (items) => items.filter((item) => item.type === 'page').map((item) => item.url);
  assert.equal(pages(await zhEngine.search('新建虚拟机'))[0], '/docs/api-reference/create-vm');
  assert.equal((await zhEngine.search('新建虚拟机', { limit: 1 })).length, 1);
  assert.equal(pages(await zhEngine.search('创建虚拟机'))[0], '/docs/api-reference/create-vm-backup');
  assert.equal(pages(await zhEngine.search('/v1/backup-storage'))[0], '/docs/api-reference/query-backup-storage');
  const headingResults = await zhEngine.search('请求地址');
  assert.equal(pages(headingResults)[0], '/docs/api-reference/query-backup-storage');
  assert.ok(headingResults.some((item) => item.type === 'heading' && item.url.endsWith('#request')));
  assert.deepEqual(pages(await enEngine.search('virtual machine')), ['/en/docs/virtual-machine']);

  const tail = (await zhEngine.search('needle-at-tail')).find((item) => item.type === 'text');
  assert.ok(tail?.content.includes('needle-at-tail'));
  assert.ok(tail.content.length < 500);
  const unsafe = (await zhEngine.search('onerror')).find((item) => item.type === 'text');
  assert.match(unsafe?.content ?? '', /\\<img src="x" <mark>onerror<\/mark>="alert\(1\)">/);
  assert.ok(unsafe.content.includes('"quoted"'));
  assert.ok(!unsafe.content.includes('&quot;'));
  assert.equal((unsafe.content.match(/<mark>/g) ?? []).length, 1);
  assert.equal((unsafe.content.match(/<\/mark>/g) ?? []).length, 1);
});
