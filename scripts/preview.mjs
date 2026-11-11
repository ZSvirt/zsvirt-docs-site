#!/usr/bin/env node

import { access } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSearchRuntime } from '../search-runtime/runtime.mjs';
import { assertPortAvailable, loopbackHost, loopbackOrigin, tcpPort } from './local-launcher.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const host = loopbackHost(process.env.DOC_SITE_HOST, 'DOC_SITE_HOST');
const port = tcpPort(process.env.DOC_SITE_PORT, 'DOC_SITE_PORT', 4322);
const out = join(root, 'out');
const snapshotPath = join(out, 'docs', 'search-index.json');

let server;
let runtime;
let closing;

async function close(code, error) {
  if (closing) return closing;
  if (error) console.error('[doc-site-preview]', error);
  process.exitCode = code;
  closing = (async () => {
    if (server?.listening) {
      await new Promise((resolve, reject) => server.close((failure) => failure ? reject(failure) : resolve()));
    }
    if (runtime) await runtime.close();
  })().catch((failure) => {
    console.error('[doc-site-preview] cleanup failed:', failure);
    process.exitCode = 1;
  });
  return closing;
}

async function main() {
  await access(snapshotPath);
  await assertPortAvailable(host, port);
  const { default: serveHandler } = await import('serve-handler');
  runtime = await createSearchRuntime({ snapshotPath });
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', loopbackOrigin(host, port));
      if (url.pathname === '/api/search' || url.pathname === '/health') {
        const result = await runtime.handle(new Request(url, { method: request.method }));
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
        return;
      }
      await serveHandler(request, response, {
        public: out,
        cleanUrls: true,
        directoryListing: false,
      });
    } catch (error) {
      console.error('[doc-site-preview] request failed:', error);
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      response.end('Request failed');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => { void close(0); });
  }
  const health = await runtime.handle(new Request(new URL('/health', loopbackOrigin(host, port))));
  const { version } = await health.json();
  console.info(JSON.stringify({ component: 'doc-site-preview', event: 'ready', url: loopbackOrigin(host, port), version }));
}

main().catch((error) => { void close(1, error); });
