# CLAUDE.md

Guidance for Claude Code working in this repo. The product overview is in `README.md`, the decisions (D1–D11) in `docs/decisions.md` and the setup in `docs/getting-started.md`; this file covers how to work on the code.

## Project

Self-hosted cookie-consent platform for websites that run on the same server.

- **consent-api**: one **internal** HTTP service that runs a [c15t](https://c15t.com/docs/self-host) backend instance for each registered website (multi-tenant). It binds to `CONSENT_API_HOST:CONSENT_API_PORT` (default `127.0.0.1:4100`, a private LAN address is allowed) and has no public hostname.
  - Browsers reach it through each website's own nginx vhost (`https://<site>/api/c15t/*`), behind Cloudflare.
  - Website server code calls `CONSENT_API_URL` directly.
  - See docs/decisions.md D1.
- **dashboard** is private, with no SEO and no indexing. It has two roles:
  - `admin` manages websites, users and credentials, and sees every site.
  - `user` sees only the sites an admin assigned to them, and has read-only access.
  - It is built from two parts (docs/decisions.md D10):
    - **dashboard-web**: a React single-page app (Vite), shipped as static files that nginx serves.
    - **dashboard-api**: a Hono JSON API with Better Auth, on the same origin under `/api/`.
- **PostgreSQL**: a single database with two schemas. `c15t` holds consent data and is owned by the c15t migrations. `app` holds dashboard data: auth, sites, memberships and the audit log. The database runs on the existing **Patroni cluster** (5 nodes, etcd). Apps reach the leader only through its internal DNS name, plus an optional replica URL (docs/decisions.md D9).

Status: **implemented, pre-1.0 (0.x)**. consent-api, dashboard-api and dashboard-web, the shared packages, the database layer, `infra/` (nginx, systemd, `deploy.sh`) and the unit, integration and Playwright tests all exist; releases are cut from `vX.Y.Z` tags (see CONTRIBUTING.md "Releases" and docs/status.md). The layout and commands below describe the repository as it is. Update this file whenever reality diverges from it.

## Stack

Node.js 26 LTS and TypeScript (strict, ESM only), Yarn 4 through Corepack (no npm, pnpm, Bun or Turborepo), Biome, Vitest, Playwright. Versions and the rest of the stack are in `package.json`.

| Concern | Choice |
|---|---|
| Consent backend | `@c15t/backend` (v3) + `@effect/sql-pg` driver. `@c15t/cli` (pinned devDependency) for migrations |
| Dashboard auth | Better Auth: email + password, `admin` plugin, public sign-up disabled, mounted at `/api/auth/*`. Only four endpoints are exposed over HTTP (sign-in, sign-out, get-session, change-password). The UI uses `createAuthClient` from `better-auth/react` for those four, without `adminClient()`: admin actions go through `/api/admin/*` |
| Deploy | No Docker. Cloudflare (proxied) in front of nginx. nginx serves the static UI and proxies to the systemd services. PostgreSQL is the existing Patroni cluster. See docs/decisions.md D7 and D9. |

## Layout

`apps/` (consent-api, dashboard-api, dashboard-web), `packages/` (db, shared, config) and `infra/` are laid out as their names say; each app reads its env variables in `src/env.ts`. Nested `CLAUDE.md` files load when you work in `apps/consent-api/`, `apps/dashboard-api/` and `infra/`. Not obvious from the tree:

- `apps/dashboard-api/src/authz.ts` holds ALL access checks (the session loader, the site lookup and the `TenantScope` type are in `session.ts`, `site-access.ts` and `authz-types.ts` next to it).
- `apps/dashboard-web/index.html` carries `<meta name="robots" content="noindex, nofollow">` and `public/robots.txt` is `Disallow: /`.
- `packages/db` holds the Drizzle schema for `app`, its migrations and the generated c15t read types (`yarn db:pull-c15t`). `infra/postgres/init.sql` creates the roles, schemas and grants.
- `c15t-backend.config.ts` is the config of the c15t migration CLI.
- `infra/test/` is the test-only nginx container plus `nginx-snippet.test.sh` (needs Docker), `update-cloudflare-ips.test.sh` and `uninstall.test.sh` (no Docker, no root; run in CI).
- `eslint.config.mjs` is type-aware through each workspace's `tsconfig.json` + `tsconfig.test.json`, and `tsconfig.tools.json` for configs and e2e.
- `stryker.config.mjs`, `vitest.mutation.config.ts` and `tsconfig.mutation.json` are the mutation-testing setup (`yarn mutation`); it never touches a database.
- `scripts/check-code-caps.ts` (+ `scripts/code-caps/`) and `.code-caps-baseline.json` are the size caps with a ratchet baseline (`yarn code-caps`).
- The Yarn rc file sets `nodeLinker`, `injectEnvironmentFiles` and `packageExtensions`.

## Commands

Scripts are in `package.json`. Not obvious from there:

```bash
corepack enable          # once per machine; the Yarn version comes from packageManager
yarn lint:eslint         # ESLint zero-findings gate (strictTypeChecked, sonarjs, security, no-unsanitized, size caps); needs `yarn typecheck` first
yarn test:e2e:visual     # screenshot spec only; baselines come from .github/workflows/visual.yml (docs/quality-gates.md)
yarn c15t:migrate        # @c15t/cli self-host migrate --config ./c15t-backend.config.ts --apply (run `yarn c15t:plan` and review it first)
yarn admin:create --email you@example.com   # bootstrap first admin, prints a one-time password
yarn semgrep             # scripts/semgrep.sh: registry rule sets, exit 1 on any finding (skips with exit 0 when semgrep is missing and CI is unset)
yarn trivy               # scripts/trivy.sh: trivy fs vuln,secret,misconfig, HIGH/CRITICAL fail, .trivyignore needs exp: dates (same skip rule); see docs/security-scanning.md
yarn qodana              # scripts/qodana.sh: JetBrains Qodana on a copy of the tree; needs QODANA_TOKEN, Docker and the qodana CLI, refuses otherwise; advisory, never run with a token yet (docs/security-scanning.md)
yarn build && infra/deploy.sh               # yarn workspaces foreach -Apt run build; systemd restart
scripts/verify-reproducible-build.sh       # two clean builds of HEAD in different dirs/time zones; every dist/ and release file must match (CI job "Reproducible build")
```

The other gates (`yarn test:coverage` at 100%, `knip`, `type-coverage`, `fta`, `code-caps`, whose ratchet `--update` only lowers the baseline, `mutation`, `test:scripts-coverage`) are described in `docs/quality-gates.md`; lefthook runs the whole set before a push.

Run `yarn typecheck && yarn lint && yarn lint:eslint && yarn test` before you call a task done. ESLint (`eslint.config.mjs`) is a zero-findings gate: fix the finding, or silence a proven false positive on that line with `// eslint-disable-next-line <rule> -- <reason>`; never add a file-wide or rule-wide disable. Biome owns the rules both tools have (`no-explicit-any`, non-null assertions, unused variables, the React hooks rules).

## Architecture rules

### Network configuration

- **CI and test ports are random.** The e2e stack, the nginx snippet test and the CI PostgreSQL container pick a free port from 50001 to 65535 (`e2e/support/ports.ts`, `scripts/ci-start-postgres.sh`); never a fixed one, and `scripts/ci-bootstrap-db.sh` has no default `PGPORT`. See `docs/ci-runners.md`.
- **Never hard-code addresses or ports** (`127.0.0.1`, `4100`, `4200`, `5173`) in code or snippets. Defaults live only in the zod schemas in each app's `src/env.ts`, and in `vite.config.ts` for the dev server. nginx gets addresses only from the rendered `upstreams.conf`.
- `CONSENT_API_HOST` and `DASHBOARD_API_HOST` must be a loopback address or a private LAN address: RFC 1918, CGNAT `100.64.0.0/10` (WireGuard / Tailscale), or IPv6 ULA `fc00::/7`. Env validation **rejects** `0.0.0.0`, `::` and public IPs. Ports are integers from 1024 to 65535.
- `CONSENT_API_TRUSTED_PROXIES` is a comma-separated CIDR list, default `127.0.0.1/32,::1/128`. consent-api reads the TCP peer with `getConnInfo(c)` from `@hono/node-server/conninfo`. If the peer is **not** in that list, consent-api deletes the `X-Forwarded-*`, `CF-*` and `Forwarded` headers before it calls the c15t handler. This way the IP and geo data can never be spoofed.
- The dev UI is the Vite dev server. It binds `127.0.0.1:${DASHBOARD_WEB_DEV_PORT}` and proxies `/api` to `DASHBOARD_API_HOST:DASHBOARD_API_PORT`, so dev stays same-origin, just like production.

### Multi-tenancy (consent-api)

Full rules in `apps/consent-api/CLAUDE.md` (loads when you work under `apps/consent-api/`). Always: one `c15tInstance` per site with `requireTenantId: true`; the tenant comes only from the registry lookup of `siteKey` (set by the site's nginx vhost), never from a header, a cookie or a body field; `trustedOrigins` is never empty and never holds `*`.

### Dashboard API (dashboard-api)

Full rules (data access, authorization, credentials) in `apps/dashboard-api/CLAUDE.md` (loads when you work under `apps/dashboard-api/`). Always: dashboard-api is the security boundary and checks access only in `authz.ts`; it reads `c15t.*` through the read-only role, filters every query by the allowed tenant IDs and never writes there; admin-only mutations write `app.admin_audit` in the same transaction; users are read-only; never delete consent records from the dashboard (mark the site `disabled` instead).

### PostgreSQL (Patroni cluster)

- Never connect to a Patroni node by its own name or IP, and never talk to etcd or Patroni. The leader is reached through an **internal DNS name**, which is repointed on failover.
  - Never cache or pin the resolved IP.
  - On primary pools, set `target_session_attrs: 'read-write'` (postgres.js), `connect_timeout` of about 5 s, TCP keepalive, and a capped `max_lifetime` (a few minutes). Together these flush connections that are still on the old leader after a DNS flip.
  - c15t's `database: { dialect, url, schema }` shortcut builds `PgClient.layer({ url })` with **default pool settings** (10 connections, 10 s idle timeout, no lifetime cap) and passes nothing else through. For pool control pass a layer instead: `database: PgClient.layer({ url: Redacted.make(url), maxConnections: 3, connectionTTL: '5 minutes', connectTimeout: '5 seconds', startupParameters: { search_path: 'c15t', timezone: 'UTC' } })`. The shortcut sets that `search_path` and UTC for you, a layer must do it itself.
  - `@effect/sql-pg` 4 is its own protocol client, not `pg`: it has **no** `target_session_attrs` and no keepalive option. consent-api's per-site c15t pools (`createDatabaseLayer` in `apps/consent-api/src/instance-database.ts`) therefore have no `read-write` check. They get a keepalive socket from a custom `stream: () => net.connect({ keepAlive: true, ... })` (not for a `?host=` unix-socket URL), `connectTimeout` 5 s and `connectionTTL` 5 minutes, and rely on the failover error handling: evict the instance on a database error, retry reads once, never retry writes.
  - `@consent/db` `createPool`/`createDatabase` set all four for postgres.js: `target_session_attrs` (`read-write` on the primary, `prefer-standby` on the replica), `connect_timeout`, TCP keepalive and `max_lifetime`. Used by dashboard-api, `yarn db:migrate`, `yarn admin:create` and the consent-api site registry. The `LISTEN` connection sets them too (`listenConfig` in `apps/consent-api/src/listener-config.ts`), plus a periodic ping (`listener-watch.ts`).
  - TLS: postgres.js honours `sslmode` (`require` encrypts without verifying) and sends an unknown `sslrootcert=<file>` to Postgres as a startup parameter, which Postgres rejects, so never put `sslrootcert` in a URL. `@effect/sql-pg` turns `require`, `verify-ca` and `verify-full` into plain TLS with Node's trust store, so it always verifies. For a private CA set `NODE_EXTRA_CA_CERTS` in the service env file; it covers both drivers.
- Use these URLs only:
  - `DATABASE_URL_C15T` and `DATABASE_URL_DASHBOARD` → the primary.
  - `DATABASE_URL_DASHBOARD_REPLICA` → replicas. It is optional.
- The replica pool (`db.analytics`) is used **only** for read-only analytics over `c15t.*` (stats, search, export). Authz, `app.*` reads and every write go to `db.primary`. Every query picks its pool explicitly.
- The consent-api `LISTEN` connection goes to the primary.
  - On disconnect: reconnect with backoff, run `LISTEN` again, then dispose **all** cached c15t instances, because notifications sent during the failover are lost.
  - Enable TCP keepalive and send a periodic ping.
- Treat `25006 read_only_sql_transaction`, `57P01 admin_shutdown` and connection resets as failover. Drop the connection, let the pool reconnect, and return 503. Retry only reads.
- Never `process.exit()` from a pool `error` handler. Log it, and let the pool recover.
- Keep pools small: c15t per-site instance 2–3, dashboard-api ≤10. Total usage must fit the primary's `max_connections` budget (see docs/status.md, Open questions).
- Migrations (`c15t:migrate`, `db:migrate`) always run against the primary URL.
- Do not add `@axiumine/koa-utils` for database access (docs/decisions.md D11).

### Hosting (Cloudflare, nginx, systemd)

Full rules in `infra/CLAUDE.md` (loads when you work under `infra/`). Always: no Docker for deploy (no Dockerfiles or compose files, except the test-only `infra/test/compose.yaml`); the dashboard is never indexed (every response sends `X-Robots-Tag: noindex, nofollow`; no sitemap, Open Graph tags or SSR); Cloudflare must never cache or challenge `/api/c15t/*`.

## Code conventions

- The whole repository is **AGPL-3.0-or-later**. Every hand-written source file (ts, tsx, mjs, sh, css, sql, conf, tmpl) starts with the SPDX header. Run `yarn spdx` to add it to new files; `yarn spdx:check` (also in CI) fails for a file that has neither a header nor a `REUSE.toml` entry. New dependencies need an AGPL-compatible licence and an exact version pin (`docs/dependency-policy.md`). Every commit needs a DCO sign-off (`git commit -s`).
- dashboard-web may import only `@consent/shared` and `import type` from `@consent/dashboard-api`.
  - It never imports `@consent/db`, `@c15t/backend`, Node modules or server env.
  - Vite exposes only `VITE_*` variables, and none of them may hold a secret.
- Read env through one zod-validated module per app (`src/env.ts`). Never read `process.env` anywhere else.
- Validate every API input with `@hono/zod-validator`. Errors are JSON `{ error: { code, message } }`. Never leak SQL or stack traces.
- Name things by the domain: `site`, `siteKey`, `member`, `consent`, `subject`. Do not use `website`, `tenant` or `domainId` interchangeably.
- Tests use `import { test, expect } from 'vitest'`. Every authz rule needs a test that proves a `user` cannot read another site's data.

## Toolchain gotchas (Node 26 + Yarn 4)

- Node 25 and later no longer bundle Corepack, so on Node 26 run `npm install -g corepack` first, then `corepack enable` once per machine. Redo the install after a Node upgrade.
- Keep `nodeLinker: node-modules`. Do not switch to Plug'n'Play: Vite, drizzle-kit, the c15t CLI and native dependencies expect `node_modules`.
- Yarn **does not auto-install peer dependencies.** Add every peer we use as a direct dependency (for example the `@effect/sql-pg` version c15t pins). If a dependency declares peers that we don't use, mark them optional through `packageExtensions` in `.yarnrc.yml`. That keeps `yarn install` free of warnings.
- `.yarnrc.yml` sets `injectEnvironmentFiles: ['.env?']`, so `yarn <script>` loads `.env` in dev. In production, systemd starts `/usr/bin/node` directly with `EnvironmentFile=`, and the server has no `.env*` files.
- Pin CLIs (`@c15t/cli`, `drizzle-kit`, `@playwright/test`) as devDependencies. Do not run them with unpinned `yarn dlx`.
- If `npm install -g corepack` fails with EEXIST on `yarn`, an old global Yarn 1 sits in the same bin directory. Use `npm install -g corepack --force`, then `corepack enable`.
- Yarn 4.18 refuses package versions that are only hours old ("quarantined"). That is why `postgres` is pinned to 3.4.9 (4.0.0 was too new). Bump it once the gate passes.
- `@c15t/backend` and `@c15t/cli` move together, with `@c15t/schema` at the exact version `@c15t/backend` lists as its dependency (3.2.2 with schema 3.1.3), so the lockfile holds one `@c15t/schema` and one `@c15t/translations`. Dependabot's cooldown can split the `c15t-stack` group (a schema patch becomes eligible days before the backend minor it was released with); bump the rest of the set in that pull request instead of merging the schema alone. Keep `@effect/sql-pg` at the exact version `@c15t/backend` lists as its peer (4.0.0). After every upgrade, diff the old and new `dist/` and re-check the c15t statements in this file, `docs/security-model.md` and `docs/assurance-case.md` (4.3, 4.4).
- TypeScript is pinned to 6.0.3. 7.x is the native compiler with an unstable JS API, which breaks tools that import `typescript`.
- c15t's own dependencies leave a few peers unmet (`@standard-schema/spec`, `@types/json-schema`, `openapi-types`, and an `effect` range). `yarn install` reports them as YN0086 (exit code 0). Add them as `packageExtensions` for `@c15t/backend@*` in `.yarnrc.yml` to silence it.
- c15t's CLI loads the dev env file itself (c12), so `yarn c15t:plan` works without Yarn's injection. Every other script depends on `injectEnvironmentFiles`.

### Workspace conventions (set up in the foundation)

- Internal dependencies use the `workspace:*` protocol. CI and deploys run `yarn install --immutable`. Commit `yarn.lock` and `.yarnrc.yml`.
- Tests live next to the code as `src/**/*.test.ts`. Each workspace has a `vitest.config.ts` (`defineProject`) and the root `vitest.config.ts` lists `projects: ['packages/*', 'apps/*']`. dashboard-web switches its project to `jsdom`.
- A new workspace needs `tsconfig.json` (the `src` build, tests excluded, emits to `dist/`) and `tsconfig.test.json` (type-checks `src/**/*.test.ts`), both extending `@consent/config/tsconfig.base.json`, and both listed in the root `tsconfig.json` references, which is what `yarn typecheck` (`tsc -b`) runs.
- The base config uses `module: NodeNext`, so relative imports in `src` end in `.js`. dashboard-web overrides this with `Bundler` resolution.
- Internal packages export `{ types: dist/*.d.ts, source: src/*.ts, default: dist/*.js }`. Vitest resolves the `source` condition (`resolve.conditions` and `ssr.resolve.conditions` / `externalConditions` set to `['source']` in each workspace `vitest.config.ts`; copy an existing one), so tests run without building first. `tsc -b` builds referenced packages in order, and each build keeps its `tsbuildinfo` inside `dist/`, so deleting `dist/` resets it.
- Biome (`yarn lint`, `yarn format`) ignores `*.md` on purpose: it would rewrite our tables. `process.env['X']` is allowed (`useLiteralKeys` is off) because `noPropertyAccessFromIndexSignature` requires brackets.
- `@consent/db` tests run the real migration files in PGlite (an in-process Postgres) as a role that cannot create schemas, so they never touch the shared dev database. API integration tests against the dev database use a unique per-run prefix for site keys and emails and delete only their own rows.
- `yarn db:migrate` uses our `applyMigrations` (`packages/db/src/migrator.ts`), not Drizzle's `migrate()`. Drizzle runs `CREATE SCHEMA IF NOT EXISTS app` first, which PostgreSQL rejects for a role without CREATE on the database, even when the schema exists. The `app` schema is created by `infra/postgres/init.sql`.
- Site notifications: migration `0001_guards` makes the database send `NOTIFY site_changed, '<siteKey>'` on every insert or update of `app.site`, inside the writing transaction. dashboard-api does not need to send it.

## c15t gotchas

- Check the installed `@c15t/backend` version before you write c15t code. The API changed a lot between v1, v2 and v3. The old `adapter: kyselyAdapter(...)` style is gone, and v3 uses `database: { dialect: 'postgres', url, schema }`. Pin exact versions, and install the `@effect/sql-pg` version the backend lists as its peer dependency.
- The runtime config and the migration config must name the same Postgres `schema` (`c15t`).
- If you put PgBouncer in transaction mode in front of Postgres, prepared statements break. Connect directly, or use `PgClient.layer` with `prepare: false`.
- Subject IDs are unique across the whole database, not per tenant. A conflicting save returns `409 SUBJECT_CONFLICT`. That is expected, not a bug.
- `GET /status` returns 200 only when the database responds and the schema exists. Use it as the consent-api health check.
- Docs: https://c15t.com/docs/self-host (configuration, endpoints, node-sdk, database-setup).
