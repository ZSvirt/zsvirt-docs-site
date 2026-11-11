# ZSvirt documentation site

This repository is the source of truth for the bilingual documentation website and its search service. It is independent of the main website and requires no private repository, database or SSH access for local development.

## Structure and commands

- `content/docs/{zh,en}` and `content/api-reference/{zh,en}` contain the product documentation. Preserve public slugs and valid section links when editing.
- `src/` contains the Next.js/Fumadocs application; `search-runtime/` provides Orama keyword search. The production output is static HTML and RSC payloads in `out/`, with the bundled search server under `out/_doc-search/`.
- Use the Node version in `.node-version` and pnpm version in `package.json`.
- `pnpm install --frozen-lockfile`, `pnpm dev`, `pnpm test`, `pnpm test:terraform`, `pnpm types:check`, `pnpm build`, `pnpm preview`.
- Browser acceptance: run the preview, then `pnpm test:site:e2e` and `pnpm test:search:e2e`. The tests require Playwright Chromium.
- Content maintenance utilities are under `scripts/content/`. Terraform import requires an explicit source checkout; normal builds only consume the checked-in content.

## Boundaries

Serve documentation at `/docs` and `/en/docs`; the official origin is `https://docs.zsvirt.io`. Main website links are external. Keep document edit links tied to their real source paths, not rewritten public slugs. Root navigation remains on the documentation site.

Do not add analytics that sends fork/development traffic to official services. Public defaults contain no analytics. Do not add a CMS, private data source or compatibility copy of the main site.

## Validation and delivery

Choose checks for the affected behavior. Application-wide migrations must verify both languages, search, generated links/assets, and a production build. Never update generated output to hide a source error. Deployment credentials must not be used by pull-request jobs.

`main` changes build and deploy after CI checks; PRs only validate. See `deploy/README.md` for the release protocol, restricted account, immutable artifacts, acceptance and rollback. The shared production gateway, TLS and search unit remain infrastructure-owned; content releases cannot modify them.

Preserve unrelated work. Stage explicit paths and use Conventional Commits. Production writes require task authorization. Record long-task handoffs in the ignored `docs/codex-handoffs/` directory, excluding private operations data from public commits.

## Licensing

Website code is Apache-2.0. Original documentation and original documentation images are CC BY 4.0. Preserve third-party notices and trademark ownership; these licenses do not grant trademark rights. See `LICENSE`, `LICENSE-CONTENT` and `NOTICE`.
