import { randomUUID } from 'node:crypto';
import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createSearchEngine } from './engine.mjs';
import { parseSnapshot } from './snapshot.mjs';

const MAX_QUERY_LENGTH = 200;
const RESULT_LIMIT = 20;

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

function failure(status, code, message, headers) {
  return json({ error: { code, message } }, status, headers);
}

function defaultLogger(level, event) {
  const line = JSON.stringify({ component: 'doc-search', level, ...event });
  if (level === 'error') console.error(line);
  else console.info(line);
}

export async function createSearchRuntime({ snapshotPath, logger } = {}) {
  if (typeof snapshotPath !== 'string' || !snapshotPath.trim()) throw new Error('snapshotPath is required');
  const filePath = resolve(snapshotPath);
  const log = (level, event) => {
    if (logger) logger[level]?.(event);
    else defaultLogger(level, event);
  };
  let current = null;
  let closed = false;
  let watcher;
  let reloadTimer;
  let reloadPromise;
  let reloadRequested = false;

  async function reload() {
    if (closed) throw new Error('Search runtime is closed');
    current = null;
    if (reloadPromise) {
      reloadRequested = true;
      return reloadPromise;
    }
    reloadPromise = (async () => {
      do {
        reloadRequested = false;
        const startedAt = performance.now();
        try {
          const input = await readFile(filePath, 'utf8');
          const snapshot = parseSnapshot(input);
          const byLocale = {
            zh: snapshot.records.filter((record) => record.locale === 'zh'),
            en: snapshot.records.filter((record) => record.locale === 'en'),
          };
          const [zhEngine, enEngine] = await Promise.all([
            createSearchEngine(byLocale.zh, 'zh'),
            createSearchEngine(byLocale.en, 'en'),
          ]);
          const engines = { zh: zhEngine, en: enEngine };
          if (closed) throw new Error('Search runtime is closed');
          if (reloadRequested) continue;
          current = {
            version: snapshot.version,
            counts: { zh: byLocale.zh.length, en: byLocale.en.length },
            engines,
          };
          const memory = process.memoryUsage();
          log('info', {
            event: 'snapshot_ready', version: snapshot.version, counts: current.counts,
            elapsedMs: Math.round(performance.now() - startedAt),
            processRssBytes: memory.rss, processHeapUsedBytes: memory.heapUsed,
          });
        } catch (error) {
          current = null;
          log('error', { event: 'snapshot_load_failed', code: 'SNAPSHOT_LOAD_FAILED', reason: error instanceof Error ? error.message : String(error) });
          if (!reloadRequested) throw error;
        }
      } while (reloadRequested);
    })().finally(() => { reloadPromise = undefined; });
    return reloadPromise;
  }

  function scheduleReload() {
    if (reloadPromise) {
      current = null;
      reloadRequested = true;
      return;
    }
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      (async () => {
        try {
          const snapshot = parseSnapshot(await readFile(filePath, 'utf8'));
          if (current?.version === snapshot.version) return;
        } catch {
          // Reload records the exact failure and clears readiness.
        }
        await reload();
      })().catch((error) => log('error', { event: 'scheduled_reload_failed', code: 'SNAPSHOT_RELOAD_FAILED', reason: error instanceof Error ? error.message : String(error) }));
    }, 75);
  }

  await reload();
  watcher = watch(dirname(filePath), (eventType, filename) => {
    if (filename === null || String(filename) === basename(filePath)) scheduleReload();
  });
  watcher.on('error', (error) => {
    current = null;
    log('error', { event: 'snapshot_watch_failed', code: 'SNAPSHOT_WATCH_FAILED', reason: error.message });
  });

  async function handle(request) {
    const requestId = randomUUID();
    const startedAt = performance.now();
    let pathname;
    let locale = null;
    const respond = (response, details) => {
      response.headers.set('x-request-id', requestId);
      if (current?.version) response.headers.set('x-doc-search-version', current.version);
      log(details.errorCode ? 'error' : 'info', {
        event: 'search_request_complete', requestId, locale,
        elapsedMs: Math.round(performance.now() - startedAt),
        status: response.status, ...details,
      });
      return response;
    };
    const reject = (status, code, message, headers) => respond(failure(status, code, message, headers), { errorCode: code });
    try {
      const url = new URL(request.url);
      pathname = url.pathname;
      if (pathname !== '/api/search' && pathname !== '/health') {
        return failure(404, 'NOT_FOUND', 'Route not found');
      }
      if (request.method !== 'GET') {
        if (pathname === '/api/search') return reject(405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed', { allow: 'GET' });
        return failure(405, 'METHOD_NOT_ALLOWED', 'Only GET is allowed', { allow: 'GET' });
      }
      if (pathname === '/health') {
        if (url.search) return failure(400, 'INVALID_REQUEST', 'Health does not accept query parameters');
        return json({ ready: Boolean(current), version: current?.version ?? null, counts: current?.counts ?? { zh: 0, en: 0 } }, current ? 200 : 503);
      }
      const params = url.searchParams;
      const requestedLocale = params.get('locale');
      if (requestedLocale === 'zh' || requestedLocale === 'en') locale = requestedLocale;
      if ([...params.keys()].some((key) => key !== 'query' && key !== 'locale') || params.getAll('query').length !== 1 || params.getAll('locale').length !== 1) {
        return reject(400, 'INVALID_REQUEST', 'Exactly one query and locale are required');
      }
      const query = params.get('query').trim();
      if (requestedLocale !== 'zh' && requestedLocale !== 'en') return reject(400, 'INVALID_LOCALE', 'Locale must be zh or en');
      if (query.length > MAX_QUERY_LENGTH || /[\u0000-\u001f\u007f]/u.test(query)) {
        return reject(400, 'INVALID_QUERY', 'Query must be at most 200 characters without control characters');
      }
      const state = current;
      if (!state) return reject(503, 'SEARCH_UNAVAILABLE', 'Search index is unavailable');
      if (!query) return respond(json([]), { resultCount: 0 });
      const results = await state.engines[locale].search(query, { limit: RESULT_LIMIT });
      if (current !== state) return reject(503, 'SEARCH_UNAVAILABLE', 'Search index is unavailable');
      return respond(json(results), { resultCount: results.length });
    } catch (error) {
      if (pathname === '/api/search') return reject(500, 'SEARCH_FAILED', 'Search request failed');
      log('error', { event: 'request_failed', code: 'SEARCH_REQUEST_FAILED', errorType: error instanceof Error ? error.name : 'UnknownError' });
      return failure(500, 'SEARCH_FAILED', 'Search request failed');
    }
  }

  async function close() {
    closed = true;
    current = null;
    clearTimeout(reloadTimer);
    watcher?.close();
    if (reloadPromise) await reloadPromise.catch(() => {});
  }

  return { handle, reload, close };
}
