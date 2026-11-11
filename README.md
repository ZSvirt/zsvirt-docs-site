# ZSvirt documentation site

The bilingual documentation source for [docs.zsvirt.io](https://docs.zsvirt.io), built with Next.js and Fumadocs. The product website is [zsvirt.io](https://zsvirt.io). Chinese documentation lives at `/docs`; English documentation lives at `/en/docs`. `/` opens the Chinese documentation entry. Documentation, assets and search are served by the documentation domain. No Google Analytics or official-site tracking is enabled.

## Requirements and installation

Use Node.js matching `^22.23.4 || ^24.22.1 || ^26.12.1` and pnpm **10.30.3**, as declared in `package.json`. Python 3 is needed only for the authoring utilities and their tests.

```sh
git clone https://github.com/ZSvirt/zsvirt-docs-site.git
cd zsvirt-docs-site
corepack enable
corepack prepare pnpm@10.30.3 --activate
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:4322`. The development launcher starts Next.js and the search service together. Run all commands from this repository root; no sibling checkout or Nx workspace is required.

## Checks, build and preview

```sh
pnpm test
pnpm test:terraform
pnpm types:check
pnpm build
pnpm preview
```

`pnpm preview` serves the production export and search at `http://127.0.0.1:4322`. Keep it running while executing browser checks in another terminal:

```sh
pnpm exec playwright install chromium
pnpm test:site:e2e
pnpm test:search:e2e
```

`DOC_SITE_URL` selects a different loopback preview URL for those checks. `DOC_SITE_HOST` and `DOC_SITE_PORT` configure the local dev/preview listener. `DOC_SEARCH_HOST` and `DOC_SEARCH_PORT` configure the development search listener (defaults: `127.0.0.1:4323`).

The build writes static HTML, RSC payloads, `_next` assets, images, `sitemap.xml` and `robots.txt` to `out/`. The combined bilingual search snapshot is emitted at `out/docs/search-index.json` and used by the runtime. `out/_doc-search/` contains the bundled `server.mjs`, `runtime.json` and `THIRD-PARTY-LICENSES.txt`. `.source/`, `.next/`, `out/` and `test-results/` are generated artifacts, not document sources.

For a release build, set `DOC_SEARCH_SOURCE_COMMIT` to the full source Git SHA before `pnpm build`. This records provenance in search runtime metadata. Release packaging and verification are exposed as `pnpm release:package --commit <full-SHA>` and `pnpm release:verify --source out`; deployment operations use `pnpm run deploy -- check|upgrade|rollback`. See [deploy/README.md](deploy/README.md). Production credentials belong in deployment secrets, never in this repository or a public pull request.

## Search

After building, run the search service independently:

```sh
pnpm search:start
curl 'http://127.0.0.1:4323/health'
curl 'http://127.0.0.1:4323/api/search?query=QueryBackupStorage&locale=en'
```

`DOC_SEARCH_SNAPSHOT` can select an explicit snapshot file. Production hosting must route `/api/search` to the search service on the same documentation origin; serving `out/` alone does not provide interactive search. The preview command already integrates both. Search indexes stay on the server rather than being downloaded by the browser.

Canonical and alternate-language URLs use `https://docs.zsvirt.io`. Main-site navigation uses `https://zsvirt.io`; `NEXT_PUBLIC_MAIN_SITE_BASE_URL` may override that origin at build time for another installation.

## Content and contributions

- `content/docs/{zh,en}/`: guides and tutorials.
- `content/api-reference/{zh,en}/`: API documentation.
- `public/docs/`: documentation images; `public/brand/`: brand assets.
- `src/`: layouts, navigation, metadata and document components.
- `search-runtime/`: server-side bilingual search.

Use each page's GitHub edit link to edit its actual source file, including language and `index.mdx`. Public section names may differ from source directory names: `install-zsphere` maps to `install-zsvirt`, and `terraform-for-zsphere` maps to `terraform-for-zsvirt`. Preserve those mappings when editing links. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow and [SECURITY.md](SECURITY.md) for private vulnerability reporting. Existing copyright and license notices must be retained.

The Terraform authoring tools accept an explicit provider checkout:

```sh
python3 scripts/convert-terraform-docs.py --source-root /path/to/provider-checkout --check
python3 scripts/convert-terraform-docs.py --source-root /path/to/provider-checkout
python3 scripts/translate-terraform-docs-zh.py --check
python3 scripts/translate-terraform-docs-zh.py
```

Conversion reads `docs/index.md`, `docs/resources/` and `docs/data-sources/` from that checkout. Omitting `--check` updates generated reference pages and removes orphaned generated files. Review the diff before committing. The provider configuration translation remains manually maintained; the translation tool reports when its source digest requires review.

## License and attribution

Website code is licensed under [Apache-2.0](LICENSE). Original documentation and original documentation images are licensed under [CC BY 4.0](LICENSE-CONTENT). Preserve third-party licenses and attribution. ZSvirt, ZStack and other product names and logos remain subject to their owners' trademark rights; these licenses do not grant trademark rights. See [NOTICE](NOTICE).
