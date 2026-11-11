#!/usr/bin/env node

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSnapshot } from '../search-runtime/snapshot.mjs';
import { getDocRedirectTarget } from '../src/lib/doc-redirects.ts';

const out = fileURLToPath(new URL('../out/', import.meta.url));
const snapshot = parseSnapshot(await readFile(join(out, 'docs', 'search-index.json'), 'utf8'));
const counts = { zh: 0, en: 0 };
let anchors = 0;
const attributeText = (text) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const renderedUrls = new Set((await readdir(out, { recursive: true }))
  .filter((path) => /^(?:en\/)?docs(?:\/.*)?\.html$/.test(path))
  .map((path) => `/${path.slice(0, -5)}`)
  .filter((url) => {
    const locale = url.startsWith('/en/') ? 'en' : 'zh';
    const slugs = url.replace(/^\/(?:en\/)?docs\/?/, '').split('/').filter(Boolean);
    return !getDocRedirectTarget(locale, slugs);
  }));
const indexedUrls = new Set(snapshot.records.map((record) => record.url));
const missing = [...renderedUrls].filter((url) => !indexedUrls.has(url));
const extra = [...indexedUrls].filter((url) => !renderedUrls.has(url));
if (missing.length || extra.length) {
  throw new Error(`Search coverage differs from rendered documents: missing=${JSON.stringify(missing)}, extra=${JSON.stringify(extra)}`);
}

for (const record of snapshot.records) {
  const html = await readFile(join(out, `${record.url.slice(1)}.html`), 'utf8');
  counts[record.locale] += 1;
  for (const heading of record.structuredData.headings) {
    if (!html.includes(`id="${attributeText(heading.id)}"`)) {
      throw new Error(`Search result points to a missing rendered anchor: ${record.url}#${heading.id}`);
    }
    anchors += 1;
  }
}

console.info(JSON.stringify({ component: 'doc-search-build', event: 'verified', version: snapshot.version, counts, anchors }));
