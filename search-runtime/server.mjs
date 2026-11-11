import { realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSearchRuntime } from './runtime.mjs';

const DOC_SITE_ROOT = fileURLToPath(new URL('../', import.meta.url));

export function hostFrom(value) {
  const host = value ?? '127.0.0.1';
  if (host === '127.0.0.1' || host === '::1') return host;
  if (typeof host === 'string' && isIP(host) === 4) {
    const [first, second] = host.split('.').map(Number);
    if (first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)) return host;
  }
  throw new Error('DOC_SEARCH_HOST must be loopback or a specific RFC1918 IPv4 address');
}

function portFrom(value) {
  const port = value ?? '4323';
  if (typeof port !== 'string' || !/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535) {
    throw new Error('DOC_SEARCH_PORT must be an integer between 1 and 65535');
  }
  return Number(port);
}

function snapshotFrom(value) {
  const path = value ?? 'out/docs/search-index.json';
  if (typeof path !== 'string' || !path.trim()) throw new Error('DOC_SEARCH_SNAPSHOT must be a nonempty path');
  return resolve(DOC_SITE_ROOT, path);
}

export async function checkSnapshot(snapshotPath) {
  const runtime = await createSearchRuntime({ snapshotPath });
  try {
    const checks = [
      { query: 'QueryBackupStorage', locale: 'zh', url: '/docs/api-reference/compute/image-storage/image-storage/query-backup-storage' },
      { query: 'QueryBackupStorage', locale: 'en', url: '/en/docs/api-reference/compute/image-storage/image-storage/query-backup-storage' },
      { query: '初始密码', locale: 'zh', url: '/docs/user-guide/getting-started/login' },
      { query: '新建虚拟机', locale: 'zh', url: '/docs/api-reference/compute/vm/create-vm-instance' },
    ];
    for (const check of checks) {
      const url = new URL('http://localhost/api/search');
      url.searchParams.set('query', check.query);
      url.searchParams.set('locale', check.locale);
      const response = await runtime.handle(new Request(url));
      if (!response.ok) throw new Error(`Search snapshot check failed for ${check.locale}: HTTP ${response.status}`);
      const results = await response.json();
      const localePrefix = check.locale === 'en' ? '/en/docs' : '/docs';
      if (!Array.isArray(results) || results.length === 0 ||
          results.some((item) => typeof item.url !== 'string' || (item.url !== localePrefix && !item.url.startsWith(`${localePrefix}/`))) ||
          !results.some((item) => item.type === 'page' && item.url === check.url)) {
        throw new Error(`Search snapshot check failed for ${check.locale}: expected page missing or locale mismatch`);
      }
    }
    const health = await runtime.handle(new Request('http://localhost/health'));
    if (!health.ok) throw new Error('Search snapshot health check failed');
    return await health.json();
  } finally {
    await runtime.close();
  }
}

export async function startSearchServer({ snapshotPath, host = '127.0.0.1', port = 4323, logger } = {}) {
  host = hostFrom(host);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Search server port must be between 0 and 65535');
  const runtime = await createSearchRuntime({ snapshotPath: snapshotPath ?? snapshotFrom(), logger });
  const server = createServer(async (request, response) => {
    try {
      const path = request.url ?? '/';
      if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid HTTP request target');
      const webRequest = new Request(new URL(path, 'http://localhost'), { method: request.method });
      const result = await runtime.handle(webRequest);
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(await result.text());
    } catch (error) {
      const event = { event: 'http_adapter_failed', code: 'HTTP_ADAPTER_FAILED', errorType: error instanceof Error ? error.name : 'UnknownError' };
      const line = JSON.stringify({ component: 'doc-search', level: 'error', ...event });
      if (logger) logger.error?.(event);
      else console.error(line);
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ error: { code: 'SEARCH_FAILED', message: 'Search request failed' } }));
    }
  });
  try {
    await new Promise((fulfill, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        fulfill();
      });
    });
  } catch (error) {
    await runtime.close();
    throw error;
  }
  return {
    server,
    runtime,
    async close() {
      try {
        await new Promise((fulfill, reject) => server.close((error) => error ? reject(error) : fulfill()));
      } finally {
        await runtime.close();
      }
    },
  };
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== '--check-snapshot')) {
      throw new Error('Unknown search runtime argument');
    }
    if (args[0] === '--check-snapshot') {
      const result = await checkSnapshot(snapshotFrom(process.env.DOC_SEARCH_SNAPSHOT));
      console.info(JSON.stringify({ component: 'doc-search', level: 'info', event: 'snapshot_checked', version: result.version, counts: result.counts }));
    } else {
      const app = await startSearchServer({
        snapshotPath: snapshotFrom(process.env.DOC_SEARCH_SNAPSHOT),
        host: hostFrom(process.env.DOC_SEARCH_HOST),
        port: portFrom(process.env.DOC_SEARCH_PORT),
      });
      console.info(JSON.stringify({ component: 'doc-search', level: 'info', event: 'listening', host: app.server.address().address, port: app.server.address().port }));
      for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, () => app.close().then(() => process.exit(0), (error) => {
          console.error(JSON.stringify({ component: 'doc-search', level: 'error', event: 'shutdown_failed', reason: error.message }));
          process.exit(1);
        }));
      }
    }
  } catch (error) {
    console.error(JSON.stringify({ component: 'doc-search', level: 'error', event: 'startup_failed', reason: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  }
}
