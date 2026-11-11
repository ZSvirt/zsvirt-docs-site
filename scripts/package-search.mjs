import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { parseSnapshot } from '../search-runtime/snapshot.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(root, 'search-runtime/server.mjs');

async function bundledLicenses(inputs) {
  const packages = new Map();
  for (const input of Object.keys(inputs)) {
    if (!input.includes('node_modules/')) continue;
    let directory = dirname(resolve(process.cwd(), input));
    let found = false;
    while (basename(directory) !== 'node_modules' && directory !== dirname(directory)) {
      let data;
      try {
        data = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        directory = dirname(directory);
        continue;
      }
      if (!data.name || !data.version) {
        directory = dirname(directory);
        continue;
      }
      const key = `${data.name}@${data.version}`;
      if (!packages.has(key)) packages.set(key, { directory, data });
      found = true;
      break;
    }
    if (!found) throw new Error(`Cannot locate bundled package license metadata: ${input}`);
  }
  const sections = [
    'ZSvirt documentation search runtime — third-party licenses',
    'Generated from the packages included in the esbuild bundle.',
    '',
  ];
  for (const [key, { directory, data }] of [...packages.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const declaration = typeof data.license === 'string' ? data.license : data.license === undefined ? 'not declared' : JSON.stringify(data.license);
    sections.push(`===== ${key} =====`, `Declared license: ${declaration}`, '');
    const files = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^(?:LICEN[CS]E|COPYING|NOTICE)(?:\..*)?$/i.test(entry.name))
      .map((entry) => entry.name).sort();
    for (const file of files) {
      const content = await readFile(resolve(directory, file), 'utf8');
      sections.push(`----- BEGIN ${key}/${file} -----`, content, `----- END ${key}/${file} -----`, '');
    }
  }
  return `${sections.join('\n')}\n`;
}

async function writeAtomic(path, contents) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function packageSearch({
  snapshotPath = resolve(root, 'out/docs/search-index.json'),
  outputDirectory = resolve(root, 'out/_doc-search'),
  sourceCommit,
} = {}) {
  const bundle = resolve(outputDirectory, 'server.mjs');
  const metadataPath = resolve(outputDirectory, 'runtime.json');
  const licensesPath = resolve(outputDirectory, 'THIRD-PARTY-LICENSES.txt');
  if (sourceCommit !== undefined && !/^[a-f0-9]{40}$|^[a-f0-9]{64}$/i.test(sourceCommit)) {
    throw new Error('DOC_SEARCH_SOURCE_COMMIT must be a full Git SHA');
  }
  const snapshot = parseSnapshot(await readFile(snapshotPath, 'utf8'));
  const result = await build({
    entryPoints: [source],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    packages: 'bundle',
    sourcemap: false,
    legalComments: 'eof',
    banner: { js: '/*! ZSvirt documentation search runtime. Bundled dependency licenses: THIRD-PARTY-LICENSES.txt. */' },
    metafile: true,
    write: false,
    logLevel: 'silent',
  });
  const output = result.outputFiles.find((file) => file.path === bundle);
  if (!output) throw new Error('Search runtime bundle was not generated');
  for (const item of Object.values(result.metafile.outputs)) {
    for (const dependency of item.imports) {
      if (dependency.external && !dependency.path.startsWith('node:')) {
        throw new Error(`Search runtime bundle has an external dependency: ${dependency.path}`);
      }
    }
  }
  if (output.text.includes(root)) throw new Error('Search runtime bundle contains a local workspace path');
  const licenses = await bundledLicenses(result.metafile.inputs);
  const bundleSha256 = createHash('sha256').update(output.contents).digest('hex');
  const licensesSha256 = createHash('sha256').update(licenses).digest('hex');
  const counts = {
    zh: snapshot.records.filter((record) => record.locale === 'zh').length,
    en: snapshot.records.filter((record) => record.locale === 'en').length,
  };
  const metadata = {
    minimumNodeMajor: 22,
    bundleSha256,
    licensesSha256,
    snapshotVersion: snapshot.version,
    counts,
    ...(sourceCommit === undefined ? {} : { sourceCommit: sourceCommit.toLowerCase() }),
  };
  await mkdir(dirname(bundle), { recursive: true });
  await writeAtomic(bundle, output.contents);
  await writeAtomic(licensesPath, licenses);
  await writeAtomic(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const metadata = await packageSearch({ sourceCommit: process.env.DOC_SEARCH_SOURCE_COMMIT });
    console.info(JSON.stringify({ component: 'doc-search', event: 'packaged', ...metadata }));
  } catch (error) {
    console.error(JSON.stringify({ component: 'doc-search', event: 'package_failed', reason: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  }
}
