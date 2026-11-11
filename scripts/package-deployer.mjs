import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(resolve(root, 'artifacts'), { recursive: true });
await build({ entryPoints: [resolve(root, 'scripts/deploy/receiver.mjs')], outfile: resolve(root, 'artifacts/receiver.mjs'), bundle: true,
  platform: 'node', format: 'esm', target: 'node22', legalComments: 'eof',
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" } });
console.log('Packaged root-owned deployment receiver; install it separately from documentation releases.');
