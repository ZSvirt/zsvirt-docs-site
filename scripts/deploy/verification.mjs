import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { request } from 'node:http';

export function originResponse(config, pathname) {
  return new Promise((fulfill, reject) => {
    const req = request(new URL(pathname, config.origin), { headers: { Host: config.siteHost } });
    const deadline = setTimeout(() => req.destroy(new Error('Origin request timed out')), 15000);
    req.once('error', reject);
    req.once('close', () => clearTimeout(deadline));
    req.once('response', (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 32 * 1024 ** 2) req.destroy(new Error('Origin response exceeds verification limit'));
        else chunks.push(chunk);
      });
      response.once('error', reject);
      response.once('end', () => fulfill(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
    });
    req.end();
  });
}

async function responseAt(config, pathname) {
  const response = await originResponse(config, pathname);
  if (response.status !== 200) throw new Error(`Origin check failed: ${pathname} HTTP ${response.status}`);
  return response;
}

export async function verifyOrigin(config, release) {
  const manifestBytes = await readFile(join(release, 'release-manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  const metadata = JSON.parse(await readFile(join(release, '_doc-search/runtime.json'), 'utf8'));
  const actualBytes = Buffer.from(await (await responseAt(config, '/release-manifest.json')).arrayBuffer());
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const manifestSha256 = digest(manifestBytes);
  const actual = JSON.parse(actualBytes);
  if (digest(actualBytes) !== manifestSha256 || actual.component !== 'doc-site'
    || actual.releaseId !== manifest.releaseId || actual.sourceCommit !== manifest.sourceCommit
    || actual.sourceRepository !== manifest.sourceRepository) {
    throw new Error('Origin release identity or manifest digest mismatch');
  }
  for (const prefix of ['/docs', '/en/docs']) {
    const html = await (await responseAt(config, `${prefix}/user-guide`)).text();
    const script = html.match(/src="([^\"]*\/_next\/static\/[^\"]+\.js)"/);
    if (!script) throw new Error(`Missing rendered documentation: ${prefix}`);
    const asset = await responseAt(config, script[1]);
    if (!(await asset.text()).trim()) throw new Error('Empty Next static asset');
    const rsc = await (await responseAt(config, `${prefix}.txt`)).text();
    if (!rsc.trim() || /^\s*</.test(rsc)) throw new Error(`Invalid RSC payload: ${prefix}.txt`);
    const locale = prefix === '/docs' ? 'zh' : 'en';
    const query = new URLSearchParams({ query: 'QueryBackupStorage', locale });
    const response = await responseAt(config, `/api/search?${query}`);
    if (response.headers.get('x-doc-search-version') !== metadata.snapshotVersion
      || !response.headers.get('cache-control')?.includes('no-store')) throw new Error('Search version or cache contract mismatch');
    const results = await response.json();
    const expected = `${prefix}/api-reference/compute/image-storage/image-storage/query-backup-storage`;
    if (!Array.isArray(results) || !results.some((item) => item.type === 'page' && item.url === expected)
      || results.some((item) => !item.url.startsWith(`${prefix}/`))) throw new Error(`Search result mismatch: ${locale}`);
  }
  const privateResponse = await originResponse(config, '/_doc-search/runtime.json');
  if (privateResponse.status !== 404) throw new Error('Search server package must not be publicly served');
  return { releaseId: manifest.releaseId, sourceCommit: manifest.sourceCommit, sourceRepository: manifest.sourceRepository,
    manifestSha256, snapshotVersion: metadata.snapshotVersion };
}

export async function waitForSearch(config, release) {
  const metadata = JSON.parse(await readFile(join(release, '_doc-search/runtime.json'), 'utf8'));
  const deadline = Date.now() + 45000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(new URL('/health', config.searchOrigin), { signal: AbortSignal.timeout(2000) });
      if (!response.ok) throw new Error(`Search health HTTP ${response.status}`);
      const health = await response.json();
      if (!health.ready || health.version !== metadata.snapshotVersion) throw new Error('Search health version mismatch');
      return;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Search did not become ready: ${lastError?.message}`);
}
