# Contributing

Contributions to the Chinese and English ZSvirt documentation are welcome. Open an issue for a reproducible documentation defect or propose a pull request against `main`. For security vulnerabilities, use the private process in [SECURITY.md](SECURITY.md).

1. Fork and clone the repository, then create a focused branch.
2. Follow [README.md](README.md) to install the pinned pnpm version and dependencies.
3. Edit the source under `content/docs/` or `content/api-reference/`, preserving frontmatter, MDX components, heading anchors and existing copyright notices. Use `content-templates/` when writing a new guide. Add images under `public/docs/` and reference them with root-relative `/docs/` URLs.
4. Keep `zh` and `en` pages aligned when possible. Explain any missing translation in the pull request. Update the relevant `meta.json` when adding or moving a page.
5. Run `pnpm test`, `pnpm types:check` and `pnpm build`. For navigation, metadata, editing links or search changes, start `pnpm preview` and run the relevant `pnpm test:site:e2e` or `pnpm test:search:e2e`. Run `pnpm test:terraform` when changing those authoring tools.
6. Include the problem, resulting behavior and actual check results in the pull request. Do not commit generated build output, credentials or deployment settings containing private infrastructure details.

Public URL slugs do not always match filesystem names. Keep internal page references consistent with the loader mapping in `src/lib/source.ts`. The GitHub edit links use original source paths, not public slugs. The documentation site owns its pages, assets and search; links back to the product website use the configured main-site origin.

The Terraform conversion utilities require `--source-root` for an explicit external provider checkout. Run their `--check` mode before applying generated changes and review deletions of obsolete generated pages. Never change a license or remove attribution as part of a content cleanup.

Pull requests must pass the repository checks. Production deployment is performed from the protected release workflow, not from contributor pull requests.
