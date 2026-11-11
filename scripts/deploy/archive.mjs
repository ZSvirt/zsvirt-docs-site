import { createReadStream } from 'node:fs';
import { Parser, x } from 'tar';
import { assertRelativePath } from './artifact.mjs';

export async function inspectArchive(file, { maximumBytes = 8 * 1024 ** 3, maximumFiles = 100000 } = {}) {
  const seen = new Set();
  let bytes = 0;
  // Accept a readable as well as a file so callers can enforce upstream bounds.
  const input = typeof file === 'string' ? createReadStream(file) : file;
  await new Promise((resolve, reject) => {
    let failed = false;
    const fail = (error) => {
      if (failed) return;
      failed = true;
      input.unpipe(parser);
      input.destroy();
      // tar's public abort API also destroys its internal decompressor.
      parser.abort(error);
      reject(error);
    };
    const parser = new Parser({ strict: true, filter(pathname, entry) {
      try {
        const path = pathname.replace(/^\.\//, '').replace(/\/$/, '');
        if (!path && entry.type === 'Directory' && pathname === './') return true;
        assertRelativePath(path);
        if (!['File', 'Directory'].includes(entry.type)) throw new Error(`Unsupported archive entry: ${entry.type}`);
        if (seen.has(path)) throw new Error(`Duplicate archive path: ${path}`);
        if (!Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error('Invalid archive entry size');
        bytes += entry.size;
        if (bytes > maximumBytes || seen.size >= maximumFiles) throw new Error('Archive exceeds release limits');
        seen.add(path);
        return true;
      } catch (error) { fail(error); return false; }
    }, onReadEntry(entry) { entry.resume(); } });
    parser.on('ignoredEntry', (entry) => fail(new Error(`Unsupported archive entry: ${entry.type}`)));
    parser.on('error', fail);
    input.on('error', fail);
    parser.on('end', () => { if (!failed) resolve(); });
    input.pipe(parser);
  });
  if (!seen.has('release-manifest.json')) throw new Error('Archive lacks release manifest');
  return { bytes, entries: seen.size };
}

export async function extractArchive(file, destination, limits) {
  const info = await inspectArchive(file, limits);
  await x({ file, cwd: destination, strict: true, preservePaths: false, noChmod: true, noMtime: true, unlink: false });
  return info;
}
