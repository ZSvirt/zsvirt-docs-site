# Documentation deployment

The site is a static export plus a Node.js 22+ search service. Serve `out/` through a web server, proxy the exact `/api/search` route to the private search listener, and deny access to `/_doc-search/`. Start the bundled service with an explicit absolute `DOC_SEARCH_SNAPSHOT` pointing to `out/docs/search-index.json`; the page export, snapshot and service bundle must come from the same release.

## Official release workflow

Pull requests run tests, type checks, a static build, and browser checks without deployment credentials. Changes merged into `main` run the same checks, compare their complete output with the live release manifest, and upload only a delta archive plus release metadata to GitHub Actions artifacts. The deployment job downloads that delta and sends it to ECS. Manual workflow dispatch can rebuild and deploy `main`. There is no scheduled production deployment.

A deployment runs on a GitHub-hosted runner. The production environment supplies `DOCS_DEPLOY_HOST`, `DOCS_DEPLOY_USER`, `DOCS_DEPLOY_PORT`, `DOCS_DEPLOY_KEY` and `DOCS_DEPLOY_KNOWN_HOSTS`. Credentials are never available to pull-request jobs. Repository maintainers protect `main` and the deployment environment.

The baseline is fetched from the fixed HTTPS URL `https://docs.zsvirt.io/release-manifest.json`. Fetch or validation failures stop packaging; they do not silently trigger a full upload. The receiver binds the delta to the exact baseline manifest digest. If another release becomes current before activation, the delta is rejected and must be repackaged against the new baseline.

This reduces GitHub artifact and ECS transfer volume, not build computation: every release still builds and validates the whole site. Shared navigation or assets can legitimately change files across multiple documentation domains.

Local deployment uses the same client:

```sh
pnpm test
pnpm types:check
DOC_SEARCH_SOURCE_COMMIT=<full-commit-sha> pnpm build
export DOCS_DEPLOY_HOST=<host> DOCS_DEPLOY_USER=<user> DOCS_DEPLOY_PORT=22
export DOCS_DEPLOY_KEY_FILE=<private-key-file> DOCS_DEPLOY_KNOWN_HOSTS_FILE=<verified-known-hosts-file>
pnpm run deploy -- prepare
pnpm run deploy -- upgrade
```

`check` verifies the current documentation and search. `rollback` restores the previous release recorded by the active deployment receipt. These commands use the same environment variables. Release packaging requires a clean checkout; the commit is recorded in the page manifest and search metadata. Host keys must be verified out of band; the client does not trust a fresh network key scan automatically.

For offline packaging with an explicitly obtained baseline, use `pnpm release:package --commit <full-commit-sha> --base-manifest <manifest-path>`. Packaging without `--base-manifest` creates an explicit full archive for administrator provisioning or a deliberate full transfer. An empty server must first have a verified release and `current` initialized by its administrator; `prepare` and transactional upgrades reject a missing current release. Never replace a failed incremental deployment with an implicit full release. Source, baseline and release filesystem paths must use real directories without symbolic-link ancestors.

The delta carries the complete target manifest and only new or changed files. ECS assembles a fresh candidate directory, copying unchanged files from the verified baseline. Files absent from the target manifest are not copied, so deletions take effect without modifying the running release. Candidate verification still covers every final file and the search identities before the existing atomic activation and rollback transaction runs. Copies are independent, not hard links between releases.

Packaging and receiver logs report total output bytes, changed/reused file counts, compressed upload bytes and per-domain totals. Domain metrics group both languages by documentation section, split API reference by its next section, and list search index, search runtime and Next assets separately. The deployment receipt retains these metrics. Reusing independent copies preserves isolation between releases but does not reduce their expanded disk size.

Before enabling this workflow, the infrastructure administrator must install the receiver built from the same incremental protocol version. Updating application artifacts does not update the root-owned receiver. Baseline snapshots, delta archives and receipts are version-bound; the client and receiver do not retain an older upload-protocol compatibility path.

## Receiver installation and permissions

The receiver is installed separately by the infrastructure administrator, never replaced by a documentation upload. Package it with `node scripts/package-deployer.mjs`; install `artifacts/receiver.mjs` under `/usr/local/lib/zsvirt-docs-deploy/` and `receiver-launcher.sh` as the account's forced command. Both are root-owned and not writable by the deployment account. The receiver runs as a dedicated non-root deployment user.

The root-owned `/etc/zsvirt-docs-deploy.json` defines `root` (a concrete directory under `/opt`), `origin` (the local Nginx HTTP origin), `siteHost` (the documentation hostname), `searchOrigin` (the private search HTTP origin), and `searchService` (`zsvirt-doc-search`). Origins contain no paths or credentials. Grant the deployment user write access only to the documentation root/current link and its `releases`, `incoming` and `deployments` directories. The account's home and SSH authorization are root-owned. A dedicated writable `/var/lib/zsvirt-docs-deploy/deploy.lock` serializes all commands; its parent is not writable by the account.

Authorize its SSH key with `restrict,command="/usr/local/lib/zsvirt-docs-deploy/receiver-launcher.sh"`. Grant exactly `/usr/bin/systemctl restart zsvirt-doc-search` through sudo. Do not grant Docker, Nginx, shell, unit-file or certificate permissions. The existing search service runs under its own unprivileged systemd identity and reads the current release; its unit and limits remain infrastructure-owned.

Uploads are size-bounded and SHA256-checked. Before extraction, the receiver rejects traversal, duplicate paths, links and special archive entries, stopping parsing as soon as a limit is exceeded. It verifies every extracted file against the manifest, rejects unlisted files, checks the search bundle/snapshot identities and available disk space, then writes a durable transaction journal before switching `current` atomically. A failed service restart or origin acceptance restores the previous release and verifies recovery. The next command recovers a transaction interrupted by process termination or reboot; it refuses to overwrite an unexpected current pointer. A receipt is committed only after origin acceptance compares the complete manifest digest and verifies search and navigation resources. No command deletes historical releases or changes the shared gateway.

One Nginx instance may serve the main site and documentation through separate virtual hosts. Documentation releases do not reload or rewrite that shared configuration. Main-site and documentation commits are independent; the receiver records the repository, source commit, archive digest and exact release directory.

Release archives are limited to 1 GiB compressed and 8 GiB expanded, with at most 100,000 entries. The bilingual export currently expands to about 5.55 GB; the receiver also checks the exact declared size and requires free disk space for the expanded release, twice the archive size, and a 256 MiB reserve. Older releases are retained for rollback.
