import { execFileSync } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { assertCommit, createManifest, digestFile, verifyManifest } from './deploy/artifact.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values, positionals } = parseArgs({ allowPositionals: true, options: { commit: { type: 'string' }, source: { type: 'string', default: 'out' } } });
const [action] = positionals;
if (positionals.length !== 1 || !['package', 'verify'].includes(action)) throw new Error('Usage: release.mjs package --commit SHA | verify [--source out]');
const source = resolve(root, values.source);
if (action === 'verify') {
  const { manifest } = await verifyManifest(source, values.commit);
  console.log(JSON.stringify({ event: 'release_verified', commit: manifest.sourceCommit, fileCount: manifest.fileCount }));
} else {
  const commit = assertCommit(values.commit);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (head !== commit) throw new Error('Release commit does not match the checkout');
  const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: root, encoding: 'utf8' });
  if (dirty.trim()) throw new Error('Release packaging requires a clean checkout');
  const manifest = await createManifest(source, commit);
  const directory = resolve(root, 'artifacts');
  await mkdir(directory, { recursive: true });
  const archive = resolve(directory, `${commit}.tgz`);
  execFileSync('tar', ['-czf', archive, '-C', source, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' }, stdio: 'inherit' });
  const release = { commit, sha256: await digestFile(archive), size: (await stat(archive)).size, totalBytes: manifest.totalBytes, archive: `${commit}.tgz` };
  await writeFile(resolve(directory, 'release.json'), `${JSON.stringify(release, null, 2)}\n`);
  console.log(JSON.stringify({ event: 'release_packaged', ...release }));
}
