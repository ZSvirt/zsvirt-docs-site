# Documentation deployment

The site is a static export plus a Node.js 22+ search service. Serve `out/` through a web server, proxy the exact `/api/search` route to the private search listener, and deny access to `/_doc-search/`. Start the bundled service with an explicit absolute `DOC_SEARCH_SNAPSHOT` pointing to `out/docs/search-index.json`; the page export, snapshot and service bundle must come from the same release.

## Official release workflow

Pull requests run tests, type checks, a static build, and browser checks without deployment credentials. Changes merged into `main` run the same checks, package their exact commit, and publish the verified artifact to ECS. Manual workflow dispatch can rebuild and deploy `main`. There is no scheduled production deployment: changes should become visible after review, and scheduled GitHub workflows can be delayed or disabled after prolonged repository inactivity.

A deployment runs on a GitHub-hosted runner. The production environment supplies `DOCS_DEPLOY_HOST`, `DOCS_DEPLOY_USER`, `DOCS_DEPLOY_PORT`, `DOCS_DEPLOY_KEY` and `DOCS_DEPLOY_KNOWN_HOSTS`. Credentials are never available to pull-request jobs. Repository maintainers protect `main` and the deployment environment.

Local deployment uses the same client:

```sh
pnpm test
pnpm types:check
DOC_SEARCH_SOURCE_COMMIT=<full-commit-sha> pnpm build
pnpm release:package --commit <full-commit-sha>
DOCS_DEPLOY_HOST=<host> DOCS_DEPLOY_USER=<user> DOCS_DEPLOY_PORT=22 \
DOCS_DEPLOY_KEY_FILE=<private-key-file> DOCS_DEPLOY_KNOWN_HOSTS_FILE=<verified-known-hosts-file> \
pnpm run deploy -- upgrade
```

`check` verifies the current documentation and search. `rollback` restores the previous release recorded by the active deployment receipt. These commands use the same environment variables. Release packaging requires a clean checkout; the commit is recorded in the page manifest and search metadata. Host keys must be verified out of band; the client does not trust a fresh network key scan automatically.

## Receiver installation and permissions

The receiver is installed separately by the infrastructure administrator, never replaced by a documentation upload. Package it with `node scripts/package-deployer.mjs`; install `artifacts/receiver.mjs` under `/usr/local/lib/zsvirt-docs-deploy/` and `receiver-launcher.sh` as the account's forced command. Both are root-owned and not writable by the deployment account. The receiver runs as a dedicated non-root deployment user.

The root-owned `/etc/zsvirt-docs-deploy.json` defines `root` (a concrete directory under `/opt`), `origin` (the local Nginx HTTP origin), `siteHost` (the documentation hostname), `searchOrigin` (the private search HTTP origin), and `searchService` (`zsvirt-doc-search`). Origins contain no paths or credentials. Grant the deployment user write access only to the documentation root/current link and its `releases`, `incoming` and `deployments` directories. The account's home and SSH authorization are root-owned. A dedicated writable `/var/lib/zsvirt-docs-deploy/deploy.lock` serializes all commands; its parent is not writable by the account.

Authorize its SSH key with `restrict,command="/usr/local/lib/zsvirt-docs-deploy/receiver-launcher.sh"`. Grant exactly `/usr/bin/systemctl restart zsvirt-doc-search` through sudo. Do not grant Docker, Nginx, shell, unit-file or certificate permissions. The existing search service runs under its own unprivileged systemd identity and reads the current release; its unit and limits remain infrastructure-owned.

Uploads are size-bounded and SHA256-checked. Before extraction, the receiver rejects traversal, duplicate paths, links and special archive entries, stopping parsing as soon as a limit is exceeded. It verifies every extracted file against the manifest, rejects unlisted files, checks the search bundle/snapshot identities and available disk space, then writes a durable transaction journal before switching `current` atomically. A failed service restart or origin acceptance restores the previous release and verifies recovery. The next command recovers a transaction interrupted by process termination or reboot; it refuses to overwrite an unexpected current pointer. A receipt is committed only after origin acceptance compares the complete manifest digest and verifies search and navigation resources. No command deletes historical releases or changes the shared gateway.

One Nginx instance may serve the main site and documentation through separate virtual hosts. Documentation releases do not reload or rewrite that shared configuration. Main-site and documentation commits are independent; the receiver records the repository, source commit, archive digest and exact release directory.
