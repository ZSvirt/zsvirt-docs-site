#!/usr/bin/env node

import { watch } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parseSnapshot } from '../search-runtime/snapshot.mjs';
import { assertPortAvailable, loopbackHost, loopbackOrigin, startChild, stopChild, tcpPort, waitForTcp } from './local-launcher.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const siteHost = loopbackHost(process.env.DOC_SITE_HOST, 'DOC_SITE_HOST');
const sitePort = tcpPort(process.env.DOC_SITE_PORT, 'DOC_SITE_PORT', 4322);
const searchHost = loopbackHost(process.env.DOC_SEARCH_HOST, 'DOC_SEARCH_HOST');
const searchPort = tcpPort(process.env.DOC_SEARCH_PORT, 'DOC_SEARCH_PORT', 4323);
const snapshotPath = join(root, '.search', 'snapshot.json');
const bin = (name) => join(root, 'node_modules', '.bin', name);

if (sitePort === searchPort) {
  throw new Error('DOC_SITE_PORT and DOC_SEARCH_PORT must differ');
}

const controller = new AbortController();
const children = [];
const watchers = [];
let refreshTimer;
let refreshQueued = false;
let refreshRunning = false;
let ready = false;
let shutdownPromise;
let version;

function log(event, detail = {}) {
  console.info(JSON.stringify({ component: 'doc-site-dev', event, ...detail }));
}

function shutdown(code, error) {
  if (shutdownPromise) return shutdownPromise;
  if (error) console.error('[doc-site-dev]', error);
  process.exitCode = code;
  controller.abort();
  clearTimeout(refreshTimer);
  for (const watcher of watchers) watcher.close();
  shutdownPromise = (async () => {
    for (const child of children.reverse()) await stopChild(child);
  })().catch((failure) => {
    console.error('[doc-site-dev] cleanup failed:', failure);
    process.exitCode = 1;
  });
  return shutdownPromise;
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { void shutdown(0); });
}

function managedChild(command, args, env = process.env) {
  const entry = startChild(command, args, { cwd: root, env });
  children.push(entry);
  entry.exited.then(
    ({ code, signal }) => {
      if (!controller.signal.aborted) void shutdown(1, new Error(`${command} exited unexpectedly (${code ?? signal})`));
    },
    (error) => { if (!controller.signal.aborted) void shutdown(1, error); },
  );
  return entry;
}

async function fetchSnapshot(timeoutMs) {
  const url = new URL('/docs/search-index.json', loopbackOrigin(siteHost, sitePort));
  let response;
  try {
    response = await fetch(url, {
      headers: { 'cache-control': 'no-cache' },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]),
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Search snapshot fetch was interrupted', { cause: error });
    throw new Error(`Search snapshot request failed within ${timeoutMs}ms: ${error.message}`, { cause: error });
  }
  if (!response.ok) throw new Error(`Search snapshot response failed (${response.status})`);
  const body = await response.text();
  const snapshot = parseSnapshot(body);
  return { body, version: snapshot.version, count: snapshot.records.length };
}

async function writeSnapshot(body) {
  await mkdir(join(root, '.search'), { recursive: true });
  const tempPath = `${snapshotPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, body, { flag: 'wx', mode: 0o600 });
    await rename(tempPath, snapshotPath);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function waitForRuntime(expectedVersion) {
  const deadline = Date.now() + 120_000;
  const url = new URL('/health', loopbackOrigin(searchHost, searchPort));
  let lastError;
  while (!controller.signal.aborted && Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      const body = await response.json();
      if (response.ok && body.ready && body.version === expectedVersion) return;
      lastError = new Error(`runtime health ${response.status}, version ${body.version ?? 'none'}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(controller.signal.aborted
    ? 'Search runtime startup was interrupted'
    : `Search runtime unavailable: ${lastError?.message ?? 'no response'}`);
}

async function refresh() {
  if (refreshRunning) return;
  refreshRunning = true;
  try {
    while (refreshQueued && !controller.signal.aborted) {
      refreshQueued = false;
      const snapshot = await fetchSnapshot(120_000);
      if (snapshot.version !== version) {
        await writeSnapshot(snapshot.body);
        await waitForRuntime(snapshot.version);
        version = snapshot.version;
        log('snapshot_updated', { version, count: snapshot.count });
      } else {
        log('snapshot_unchanged', { version });
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) await shutdown(1, error);
  } finally {
    refreshRunning = false;
  }
}

function scheduleRefresh() {
  if (controller.signal.aborted) return;
  refreshQueued = true;
  if (!ready) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { void refresh(); }, 750);
}

function watchSource(path, options, filter) {
  const watcher = watch(path, options, (_event, filename) => {
    if (!filter || filename === null || filter(String(filename))) scheduleRefresh();
  });
  watcher.on('error', (error) => { void shutdown(1, error); });
  watchers.push(watcher);
}

async function main() {
  await assertPortAvailable(siteHost, sitePort);
  await assertPortAvailable(searchHost, searchPort);
  controller.signal.throwIfAborted();

  // Observe source edits even while the initial collection list is generated.
  watchSource(join(root, 'content'), { recursive: true });
  watchSource(join(root, 'src', 'lib'), { recursive: true });
  watchSource(root, {}, (name) => name === 'source.config.ts');

  const generator = startChild(bin('fumadocs-mdx'), [], { cwd: root, env: process.env });
  children.push(generator);
  const generation = await generator.exited;
  if (generation.code !== 0) throw new Error(`fumadocs-mdx failed (${generation.code ?? generation.signal})`);
  if (controller.signal.aborted) return;

  // Generated collection changes provide a second signal for additions/deletions.
  watchSource(join(root, '.source'), {}, (name) => /^(server|browser|dynamic)\.ts$/.test(name));

  managedChild(bin('next'), ['dev', '--hostname', siteHost, '--port', String(sitePort)], {
    ...process.env,
    DOC_SEARCH_HOST: searchHost,
    DOC_SEARCH_PORT: String(searchPort),
  });
  await waitForTcp(siteHost, sitePort, controller.signal);
  controller.signal.throwIfAborted();
  const snapshot = await fetchSnapshot(600_000);
  controller.signal.throwIfAborted();
  await writeSnapshot(snapshot.body);
  controller.signal.throwIfAborted();
  version = snapshot.version;

  managedChild(process.execPath, [join(root, 'search-runtime', 'server.mjs')], {
    ...process.env,
    DOC_SEARCH_HOST: searchHost,
    DOC_SEARCH_PORT: String(searchPort),
    DOC_SEARCH_SNAPSHOT: snapshotPath,
  });
  await waitForRuntime(version);
  controller.signal.throwIfAborted();

  ready = true;
  if (refreshQueued) await refresh();
  controller.signal.throwIfAborted();
  log('ready', { site: loopbackOrigin(siteHost, sitePort), search: loopbackOrigin(searchHost, searchPort), version });
}

main().catch((error) => { void shutdown(1, error); });
