# CLAUDE.md

Guidance for Claude Code working in this repo. Product overview, decisions (D1–D11) and setup live in `README.md`; this file covers how to work on the code.

## Project

Self-hosted cookie-consent platform for websites that run on the same server.

- **consent-api**: one **internal** HTTP service that runs a [c15t](https://c15t.com/docs/self-host) backend instance for each registered website (multi-tenant). It binds to `CONSENT_API_HOST:CONSENT_API_PORT` (default `127.0.0.1:4100`, a private LAN address is allowed) and has no public hostname.
  - Browsers reach it through each website's own nginx vhost (`https://<site>/api/c15t/*`), behind Cloudflare.
  - Website server code calls `CONSENT_API_URL` directly.
  - See README D1.
- **dashboard** is private, with no SEO and no indexing. It has two roles:
  - `admin` manages websites, users and credentials, and sees every site.
  - `user` sees only the sites an admin assigned to them, and has read-only access.
  - It is built from two parts (README D10):
    - **dashboard-web**: a React single-page app (Vite), shipped as static files that nginx serves.
    - **dashboard-api**: a Hono JSON API with Better Auth, on the same origin under `/api/`.
- **PostgreSQL**: a single database with two schemas. `c15t` holds consent data and is owned by the c15t migrations. `app` holds dashboard data: auth, sites, memberships and the audit log. The database runs on the existing **Patroni cluster** (5 nodes, etcd). Apps reach the leader only through its internal DNS name, plus an optional replica URL (README D9).

Status: **implemented, pre-1.0 (0.x)**. consent-api, dashboard-api and dashboard-web, the shared packages, the database layer, `infra/` (nginx, systemd, `deploy.sh`) and the unit, integration and Playwright tests all exist; releases are cut from `vX.Y.Z` tags (see CONTRIBUTING.md "Releases" and README "Status and what is next"). The layout and commands below describe the repository as it is. Update this file whenever reality diverges from it.

## Stack

| Concern | Choice |
|---|---|
| Language | TypeScript (strict), ESM only |
| Runtime | **Node.js 26 LTS**, pinned by `engines.node: ">=26 <27"` and `.nvmrc`. All app code, CLIs and tests run on Node. |
| Package manager | **Yarn 4** through Corepack, pinned in `package.json` `packageManager`. Yarn workspaces, `nodeLinker: node-modules`, `yarn.lock`. No npm, pnpm, Bun or Turborepo. |
| Consent backend | `@c15t/backend` (v3) + `@effect/sql-pg` driver. `@c15t/cli` (pinned devDependency) for migrations |
| HTTP servers | Hono on `@hono/node-server` for both consent-api and dashboard-api. Built with `tsc -b` to `dist/` |
| Dashboard UI | React 19 + Vite, TanStack Router (file routes) + TanStack Query, react-hook-form + zod, Tailwind CSS + shadcn/ui, Recharts |
| Dashboard API | Hono + `@hono/zod-validator`. The typed client for the UI is Hono RPC (`hc<AppType>`) |
| Dashboard auth | Better Auth: email + password, `admin` plugin, public sign-up disabled, mounted at `/api/auth/*`. Only four endpoints are exposed over HTTP (sign-in, sign-out, get-session, change-password). The UI uses `createAuthClient` from `better-auth/react` for those four, without `adminClient()`: admin actions go through `/api/admin/*` |
| ORM / migrations (`app` schema) | Drizzle ORM + drizzle-kit, `postgres` (postgres.js) driver |
| Validation | zod at every boundary (env, request bodies, route params, query strings, forms) |
| Lint / format | Biome |
| Tests | Vitest on Node (API integration against a real Postgres, UI with Testing Library + jsdom), Playwright (e2e) |
| Deploy | No Docker. Cloudflare (proxied) in front of nginx. nginx serves the static UI and proxies to the systemd services. PostgreSQL is the existing Patroni cluster. See README D7 and D9. |

## Layout

```
apps/
  consent-api/          Node + Hono; site registry -> c15t instance per site
    src/env.ts          zod env: CONSENT_API_HOST/PORT/TRUSTED_PROXIES, DB URL, API key, CONSENT_API_{INSTANCE,REGISTRY}_POOL_MAX (1-3), CONSENT_API_DB_PREPARE
    src/registry.ts     loads app.site rows, builds/caches/disposes c15tInstance
    src/server.ts       serve({ fetch, hostname, port }); /s/:siteKey/* -> instance.handler(request)
  dashboard-api/        Node + Hono JSON API (package @consent/dashboard-api)
    src/env.ts          zod env: DASHBOARD_API_HOST/PORT, DB URLs, auth secrets; CONSENT_API_URL and C15T_ADMIN_API_KEY are optional (reserved for future @c15t/node-sdk calls, not used yet)
    src/auth.ts         Better Auth (admin plugin, disableSignUp), mounted at /api/auth/*
    src/authz.ts        ALL access checks: requireSession / requireAdmin / requireSiteAccess middleware
    src/db.ts           db.primary and db.analytics pools (D9)
    src/c15t-read.ts    read-only queries against the c15t schema
    src/routes/         me.ts, sites.ts (detail, stats, consents, CSV stream), admin-sites.ts, admin-users.ts, admin-audit.ts, health.ts
    src/app.ts          route tree; exports `type AppType` for the RPC client
    src/server.ts       serve({ fetch, hostname, port })
  dashboard-web/        React 19 + Vite SPA, static build to dist/
    src/api.ts          hc<AppType>('/api') client + TanStack Query hooks
    src/auth.ts         better-auth/react createAuthClient (sign-in, sign-out, session, change-password only)
    src/routes/         TanStack Router file routes (route guards are UX only)
    index.html          <meta name="robots" content="noindex, nofollow">
    public/robots.txt   User-agent: * / Disallow: /
packages/
  db/                   Drizzle schema for `app`, migrations, generated c15t read types (@consent/db)
  shared/               zod schemas and enums shared by api and web (@consent/shared)
  config/               shared tsconfig, biome.json
infra/
  postgres/init.sql     roles, schemas, grants
  nginx/c15t.conf       shared `/api/c15t/` location for website vhosts (rewrite to /s/$c15t_site/)
  nginx/dashboard.conf  dashboard vhost (TLS, per-host values): listen/certs/Authenticated Origin Pulls, includes the locations
  nginx/dashboard-locations.conf  the dashboard's locations without TLS: SPA, /api/ -> c15t_dashboard_api, /assets/; also used by infra/test
  nginx/dashboard-headers.conf  noindex + CSP + security headers, included in every location
  nginx/upstreams.conf.tmpl     c15t_consent_api + c15t_dashboard_api + the $c15t_assets_cache map, rendered from env
  nginx/update-cloudflare-ips.sh  regenerates real_ip config + nftables allowlist (+ ufw script with --ufw)
  systemd/              c15t-consent-api.service, c15t-dashboard-api.service, cloudflare-ips.service + .timer, c15t-cloudflare-nft.service (reloads the nftables allowlist at boot)
  deploy.sh             build into releases/<sha>, migrate, render upstreams, switch `current`, restart, health check, rollback;
                        `install` prepares the host (user, directories, empty env files, units), `uninstall` removes it again (docs/installation.md)
  test/                 test-only nginx container (compose.yaml, stub upstream, placeholder SPA);
                        nginx-snippet.test.sh (needs Docker: nginx behaviour of the real snippets),
                        update-cloudflare-ips.test.sh (no Docker: the Cloudflare IP updater with stand-ins) and
                        uninstall.test.sh (no Docker, no root: deploy.sh install and uninstall on a temporary tree; run in CI)
c15t-backend.config.ts  config used by the c15t migration CLI
.yarnrc.yml             nodeLinker, injectEnvironmentFiles, packageExtensions
```

## Commands

```bash
corepack enable          # once per machine; the Yarn version comes from packageManager
yarn install
yarn dev                 # yarn workspaces foreach -Api run dev: consent-api, dashboard-api, Vite (proxies /api)
yarn typecheck && yarn lint && yarn test   # tsc -b, biome check, vitest run
yarn test:e2e            # Playwright
yarn db:migrate          # drizzle migrations for `app` schema
yarn c15t:plan           # @c15t/cli self-host migrate --config ./c15t-backend.config.ts --plan
yarn c15t:migrate        # same with --apply (review the plan first)
yarn db:pull-c15t        # drizzle-kit pull, schemaFilter ['c15t'] -> packages/db/src/c15t.generated.ts
yarn admin:create --email you@example.com   # bootstrap first admin, prints a one-time password
yarn spdx                # add the SPDX licence header to new source files; yarn spdx:check only verifies
yarn semgrep             # scripts/semgrep.sh: registry rule sets, exit 1 on any finding (skips with exit 0 when semgrep is missing and CI is unset)
yarn trivy               # scripts/trivy.sh: trivy fs vuln,secret,misconfig, HIGH/CRITICAL fail, .trivyignore needs exp: dates (same skip rule); see docs/security-scanning.md
yarn build && infra/deploy.sh               # yarn workspaces foreach -Apt run build; systemd restart
scripts/verify-reproducible-build.sh       # two clean builds of HEAD in different dirs/time zones; every dist/ and release file must match (CI job "Reproducible build")
```

Run `yarn typecheck && yarn lint && yarn test` before you call a task done.

## Architecture rules

### Network configuration

- **Never hard-code addresses or ports** (`127.0.0.1`, `4100`, `4200`, `5173`) in code or snippets. Defaults live only in the zod schemas in each app's `src/env.ts`, and in `vite.config.ts` for the dev server. nginx gets addresses only from the rendered `upstreams.conf`.
- `CONSENT_API_HOST` and `DASHBOARD_API_HOST` must be a loopback address or a private LAN address: RFC 1918, CGNAT `100.64.0.0/10` (WireGuard / Tailscale), or IPv6 ULA `fc00::/7`. Env validation **rejects** `0.0.0.0`, `::` and public IPs. Ports are integers from 1024 to 65535.
- `CONSENT_API_TRUSTED_PROXIES` is a comma-separated CIDR list, default `127.0.0.1/32,::1/128`. consent-api reads the TCP peer with `getConnInfo(c)` from `@hono/node-server/conninfo`. If the peer is **not** in that list, consent-api deletes the `X-Forwarded-*`, `CF-*` and `Forwarded` headers before it calls the c15t handler. This way the IP and geo data can never be spoofed.
- The dev UI is the Vite dev server. It binds `127.0.0.1:${DASHBOARD_WEB_DEV_PORT}` and proxies `/api` to `DASHBOARD_API_HOST:DASHBOARD_API_PORT`, so dev stays same-origin, just like production.

### Multi-tenancy (consent-api)

- One `c15tInstance` per site, as c15t recommends for tenants. Config per instance:
  - `basePath: '/s/<siteKey>'`
  - `tenantId: <siteKey>`
  - `requireTenantId: true`. This is mandatory. Without it a bad lookup silently writes consents with a null tenant.
  - `trustedOrigins: site.domains`
  - `manifest.policyRules`: built from the site's policy preset
  - `apiKeys: [C15T_ADMIN_API_KEY]`
- `siteKey` is immutable after creation (`^[a-z0-9-]{3,40}$`). It is the URL segment and the c15t `tenantId`.
- The browser never sees `siteKey`. Each site's nginx vhost sets it with `set $c15t_site <siteKey>; include snippets/c15t.conf;`, and the shared snippet rewrites `/api/c15t/*` to `/s/<siteKey>/*` on upstream `c15t_consent_api`. The nginx config is the trusted tenant mapping.
- Resolve the tenant **only** through the registry lookup of `siteKey`. An unknown or disabled site returns 404. Never take the tenant from a header, a cookie or a body field.
- Defense in depth: consent-api also checks that the forwarded `Host` is one of `site.domains` for that `siteKey`, and returns 404 if it is not. Reject paths that contain `..` or encoded slashes before routing. List domains **without a port**: the shipped nginx snippet forwards `$host`, which never carries a port. `domainSchema` still accepts `host:port` (validation allows it), but the `Host` check can then never match it, so every request for that site gets a 404 (a site on a non-standard port does not work behind the snippet).
- nginx restores the visitor IP from `CF-Connecting-IP` with the `real_ip` module, which trusts only Cloudflare ranges, and sends it on as `X-Forwarded-For`. Geo data comes from Cloudflare's `CF-IPCountry` and, when visitor location headers are enabled, `cf-region-code`. Verified for c15t 3.1.0: it reads `cf-ipcountry` and `cf-region-code` natively, so no mapping is needed. Without geo data, `/init` cannot resolve the jurisdiction.
  - c15t also trusts `x-c15t-country` and `x-c15t-region` **before** the Cloudflare headers, and accepts `x-vercel-ip-country`, `x-vercel-ip-country-region`, `x-amz-cf-ipcountry`, `x-country-code`, `x-country` and `x-region-code`. A visitor could pick their own jurisdiction with any of them. consent-api must delete all of these from the request before the handler, then set only the ones nginx derived from Cloudflare.
  - The default client-IP header order starts with `x-client-ip`, which a visitor can send. Set `ipAddress: { ipAddressHeaders: ['x-forwarded-for'] }` on every instance.
  - `/init` also reads `?country=`, `?region=` and `?gpc=` before any header, and `x-c15t-gpc`. consent-api strips them from every request (only `sec-gpc` carries GPC), and from untrusted peers it also drops `cf-*` and `x-forwarded-*`. A trusted peer's `X-Forwarded-For` is reduced to the single client address (right to left, skipping trusted proxies).
  - The `Host` check is skipped when the host is an IP literal or `localhost`: those are direct internal callers such as `@c15t/node-sdk` on `CONSENT_API_URL`, not browsers behind a vhost.
- Set each instance's script `backendURL` to the same-origin path `/api/c15t`. Browsers resolve a relative `backendURL` against `window.location.origin`, so it works. Server-side code (SSR prefetch, node-sdk) needs an absolute URL.
- `trustedOrigins` must never be empty, and must never contain `*` or `*.example.com` (c15t accepts both, and either would let every origin or every subdomain read the answers). Verified for the pinned 3.1.0 (`@c15t/backend` `dist/http/app.js`): the list only drives CORS response headers, and an empty list allows no cross-origin browser at all. It does **not** gate consent saves or authenticate anything, so non-browser callers are not blocked by it and the platform cannot tell a real visitor from a script (docs/security-model.md). Entries are the same strings as `site.domains`: bare host names (c15t also accepts a scheme and `:port`, but see the `Host` check above). Enforce non-empty and no wildcard with zod in dashboard-api (`domainsSchema`) and assert it again in the registry.
- Instances are cached and every instance owns a Postgres pool, so keep the per-instance pool small. A **database trigger** on `app.site` (migration `0001_guards`) sends `NOTIFY site_changed, '<siteKey>'` on every insert or update, in the writing transaction; dashboard-api does not send it. consent-api `LISTEN`s on that channel and calls `instance.dispose()` on the stale instance, then rebuilds it lazily.
- Route every method (`GET POST PUT PATCH OPTIONS`) to `handler`. A route that only allows POST breaks `/init`, `/manifest` and subject reads.
- consent-api answers `GET /health` (no database) and `GET /status` (database and `c15t` schema) at the root, for nginx, systemd and monitoring. They are not tenant routes. c15t's own `/s/<siteKey>/status` still exists.
- Response headers: every response gets `Cloudflare-CDN-Cache-Control: no-store` and `CDN-Cache-Control: no-store`. `Cache-Control: no-store` is set on errors and wherever c15t sends none. c15t's own browser `Cache-Control` on `/manifest` and `/c15t.js` is kept on purpose, so Cloudflare never caches them but browsers still do.
- Database failure on a request (a thrown failover error, or a c15t 500/503 with `cause.code` `DATABASE_ERROR` or `SERVICE_UNAVAILABLE`): the instance is evicted (5 s cooldown after creation), a `GET`/`HEAD` is retried once on a fresh instance, a write is never retried, and the client gets `503 SERVICE_UNAVAILABLE` JSON with `Retry-After: 1`. Non-JSON error bodies are rewritten to the `{ error: { code, message } }` shape.

### Dashboard data access (dashboard-api)

- c15t has **no admin endpoints for listing consents or stats**. dashboard-api reads the `c15t` schema directly, through a **read-only** Postgres role. It never writes to `c15t.*`.
- Every query against `c15t.*` filters by `tenantId IN (<sites the session can access>)`. Build the list in `authz.ts`, never from request input.
- c15t table names are camelCase (`"consentPolicy"`, `"auditLog"`), so quote them in raw SQL. Prefer the generated Drizzle types from `db:pull-c15t`. Rerun the pull after every c15t upgrade, and fix any type errors it causes.
- List endpoints use cursor pagination. CSV export streams rows from `db.analytics`, and never buffers a whole site in memory.
- Planned, **not implemented yet** (dashboard-api *will* use `@c15t/node-sdk`; it reads `c15t.*` directly today): use `@c15t/node-sdk` with the API key for the endpoints c15t does expose (`consents.check`, `legalDocuments.publish`, `experiments.summary`), with `baseUrl: ${CONSENT_API_URL}/s/<siteKey>`. dashboard-api has no SDK dependency and makes no such call, so `C15T_ADMIN_API_KEY` and `CONSENT_API_URL` are optional in its env schema; consent-api still requires the key (at least 16 characters). Make them required again in the same change that adds the first call.
- The SDK accepts plain `http:` with an API key **only for loopback hosts**. If `CONSENT_API_URL` points at a LAN address, the key-protected calls need TLS, or they must run on the consent-api host.

### Authorization (dashboard-api only)

- dashboard-api is the security boundary. Guards in dashboard-web are UX only, and the API never trusts them.
- All checks live in `apps/dashboard-api/src/authz.ts`:
  - `requireSession`
  - `requireAdmin`
  - `requireSiteAccess`, which resolves `:siteKey` against `accessibleSiteKeys(session)`.
- Each route group attaches its guard explicitly:
  - `/api/admin/*` gets `requireAdmin`. A user calling it gets 403.
  - `/api/sites/:siteKey/*` gets `requireSiteAccess`. A site the user cannot access returns **404**, which avoids site enumeration.
  - Handlers still filter every query by the allowed tenant IDs.
- A **route coverage test** iterates over `app.routes` and calls each route without a session, expecting 401. The only exceptions are an explicit allowlist (`/api/auth/*`, `/api/health`). Any new route therefore fails CI until it is guarded.
- While `mustChangePassword` is set, every route except `/api/me`, change-password and sign-out returns 403 `PASSWORD_CHANGE_REQUIRED`.
- Admin-only mutations write a row to `app.admin_audit` in the same transaction.
- Users are read-only. Only admins create, edit or disable sites, users, memberships and credentials.
- Never delete consent records from the dashboard, because they are legal proof. When an admin disables a site, mark it `disabled` and stop serving it. Keep its data.

### Credentials

- Better Auth `emailAndPassword: { enabled: true, disableSignUp: true }`, `trustedOrigins: [BETTER_AUTH_URL]`. The origin check is the CSRF guard. Cookies are httpOnly, Secure and `SameSite=Lax`.
- An admin creates each user with `auth.api.createUser` and a generated password. That password is shown to the admin **once**, and is never stored in plain text or logged.
- Admins can reset passwords (`setUserPassword`), ban or unban users, and revoke sessions. Every one of these actions is audited.
- Add rate limiting to login (the Better Auth rate limiter). The client IP comes from `X-Forwarded-For`, which nginx sets from the real visitor IP.

### PostgreSQL (Patroni cluster)

- Never connect to a Patroni node by its own name or IP, and never talk to etcd or Patroni. The leader is reached through an **internal DNS name**, which is repointed on failover.
  - Never cache or pin the resolved IP.
  - On primary pools, set `target_session_attrs: 'read-write'` (postgres.js), `connect_timeout` of about 5 s, TCP keepalive, and a capped `max_lifetime` (a few minutes). Together these flush connections that are still on the old leader after a DNS flip.
  - c15t's `database: { dialect, url, schema }` shortcut builds `PgClient.layer({ url })` with **default pool settings** (10 connections, 10 s idle timeout, no lifetime cap) and passes nothing else through. For pool control pass a layer instead: `database: PgClient.layer({ url: Redacted.make(url), maxConnections: 3, connectionTTL: '5 minutes', connectTimeout: '5 seconds', startupParameters: { search_path: 'c15t', timezone: 'UTC' } })`. The shortcut sets that `search_path` and UTC for you, a layer must do it itself.
  - `@effect/sql-pg` 4 is its own protocol client, not `pg`: it has **no** `target_session_attrs` and no keepalive option. consent-api's per-site c15t pools (`createDatabaseLayer` in `apps/consent-api/src/instance.ts`) therefore have no `read-write` check. They get a keepalive socket from a custom `stream: () => net.connect({ keepAlive: true, ... })` (not for a `?host=` unix-socket URL), `connectTimeout` 5 s and `connectionTTL` 5 minutes, and rely on the failover error handling: evict the instance on a database error, retry reads once, never retry writes.
  - `@consent/db` `createPool`/`createDatabase` set all four for postgres.js: `target_session_attrs` (`read-write` on the primary, `prefer-standby` on the replica), `connect_timeout`, TCP keepalive and `max_lifetime`. Used by dashboard-api, `yarn db:migrate`, `yarn admin:create` and the consent-api site registry. The `LISTEN` connection (`apps/consent-api/src/listener.ts`) sets them too, plus a periodic ping.
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
- Keep pools small: c15t per-site instance 2–3, dashboard-api ≤10. Total usage must fit the primary's `max_connections` budget (see README open questions).
- Migrations (`c15t:migrate`, `db:migrate`) always run against the primary URL.
- Do not add `@axiumine/koa-utils` for database access (README D11).

### Hosting (Cloudflare, nginx, systemd)

- **No Docker** for deploy. Do not add Dockerfiles or compose files for production. The one exception is `infra/test/compose.yaml`, a test-only clean nginx (host networking) that mounts the real snippets from `infra/nginx/`. Start it with `docker compose -f infra/test/compose.yaml --env-file <file with CONSENT_API_HOST/PORT and DASHBOARD_API_HOST/PORT> --env-file infra/test/test.env up -d`; add `--profile stub` for an echo upstream when the apps are not running. It renders the real `upstreams.conf.tmpl` and includes the real `dashboard-locations.conf`, so change those files, not copies.
  - consent-api and dashboard-api run as systemd services under the `c15t` system user, with secrets in `/etc/c15t-platform/*.env` (0600) loaded through `EnvironmentFile=`.
  - Both use `ExecStart=/usr/bin/node dist/server.js`, with systemd hardening (`NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp`), `NODE_ENV=production` and `TZ=UTC` (c15t stores timestamps without a time zone).
  - Both env files must set the bind host and port explicitly (`CONSENT_API_HOST/PORT`, `DASHBOARD_API_HOST/PORT`). `deploy.sh` reads them to render the nginx upstreams and to health-check (`/status`, `/api/health`), and refuses to guess.
  - dashboard-web has no process. nginx serves `/opt/c15t-platform/current/apps/dashboard-web/dist`.
- `deploy.sh` builds into `/opt/c15t-platform/releases/<git sha>`, then atomically switches the `current` symlink. This way nginx and systemd never see a half-built release. It migrates before the switch, health-checks after it, and reverts the symlink and the nginx files if the check fails (migrations are not reverted, so keep them compatible with the running release). `deploy.sh --dry-run` and `rollback` exist.
- First install order: systemd units and env files, then `infra/deploy.sh`, then the dashboard vhost. `cloudflare-ips.service` runs its script from `current/`, so it cannot start before the first deploy; the first `deploy.sh` starts it once when `conf.d/cloudflare-realip.conf` is missing. Never document starting it earlier. The nftables allowlist only survives a reboot after `systemctl enable --now c15t-cloudflare-nft.service` (or an `include "/etc/nftables.d/*.nft"` line in `/etc/nftables.conf`).
- `infra/deploy.sh install` does the host preparation (user, directories, empty 0600 env files, unit files, `enable`). `infra/deploy.sh uninstall` is its counterpart and also undoes the deploy (docs/installation.md). Uninstall never touches PostgreSQL or consent data, keeps the env files in `/etc/c15t-platform` unless `--purge-config`, never removes the `c15t` user, and removes the nginx files only after `nginx -t` passes without them (otherwise it puts them back). The Cloudflare `real_ip` file, nftables allowlist, boot unit and ufw script are host-wide, so uninstall KEEPS them unless `--remove-cloudflare` is given. It deletes under `/opt/c15t-platform` only what `deploy.sh` makes (marker files checked first), validates every path and `C15T_SERVICES` setting, and refuses a `DRY_RUN` that is not 0 or 1. `install` never overwrites an env file or changes an existing directory, and keeps a `.c15t-saved` copy of a unit file it replaces. Keep `install`, `uninstall` and `infra/test/uninstall.test.sh` in step with every file that deploy, `docs/installation.md` or `docs/nginx.md` adds to the host.
- The shared website snippet uses `location ^~ /api/c15t/`. Without `^~`, a regex location in a site's own vhost (`location ~* \.(js|json)$`) would answer the path instead of consent-api, and `nginx -t` would still pass. Check infra changes with `infra/test/nginx-snippet.test.sh` (needs Docker), `infra/test/update-cloudflare-ips.test.sh` and `infra/test/uninstall.test.sh`.
- Dashboard caching: hashed `/assets/*` get `Cache-Control: public, max-age=31536000, immutable` **only for 200 and 304**, through `map $status $c15t_assets_cache`. A 404 there is `no-store`, otherwise Cloudflare caches a missing asset for a year. `index.html` gets `no-cache`. `/api/*` responses get `no-store`.
- **No SEO, no indexing.** Every dashboard response, including `/api/*` and errors, sends `X-Robots-Tag: noindex, nofollow`. `robots.txt` disallows everything, and `index.html` carries the robots meta tag. Do not add a sitemap, Open Graph tags or SSR.
- nginx `add_header` is **not inherited** into a `location` that declares its own `add_header`. Every dashboard location therefore includes `snippets/c15t-dashboard-headers.conf`, and every `add_header` there uses `always`.
- Cloudflare must never cache `/api/c15t/*`, because `/init` depends on the visitor's country. A zone Cache Rule bypasses that path. As defense in depth, consent-api sets `Cloudflare-CDN-Cache-Control: no-store` on every response.
- Never return Cloudflare challenges or HTML error pages to `/api/c15t/*` callers. The banner calls these routes with `fetch`, so a challenge makes the call fail silently and the consent is lost.

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
- Internal dependencies use the `workspace:*` protocol. CI and deploys run `yarn install --immutable`. Commit `yarn.lock` and `.yarnrc.yml`.
- Pin CLIs (`@c15t/cli`, `drizzle-kit`, `@playwright/test`) as devDependencies. Do not run them with unpinned `yarn dlx`.
- If `npm install -g corepack` fails with EEXIST on `yarn`, an old global Yarn 1 sits in the same bin directory. Use `npm install -g corepack --force`, then `corepack enable`.
- Yarn 4.18 refuses package versions that are only hours old ("quarantined"). That is why `@c15t/*` is pinned to 3.1.0 (3.2.0 was too new) and `postgres` to 3.4.9 (4.0.0 was too new). Bump them once the gate passes, and keep `@effect/sql-pg` at the exact version `@c15t/backend` lists as its peer (4.0.0).
- TypeScript is pinned to 6.0.3. 7.x is the native compiler with an unstable JS API, which breaks tools that import `typescript`.
- c15t's own dependencies leave a few peers unmet (`@standard-schema/spec`, `@types/json-schema`, `openapi-types`, and an `effect` range). `yarn install` reports them as YN0086 (exit code 0). Add them as `packageExtensions` for `@c15t/backend@*` in `.yarnrc.yml` to silence it.
- c15t's CLI loads the dev env file itself (c12), so `yarn c15t:plan` works without Yarn's injection. Every other script depends on `injectEnvironmentFiles`.

### Workspace conventions (set up in the foundation)

- Every workspace has `tsconfig.json` (the `src` build, tests excluded, emits to `dist/`) and `tsconfig.test.json` (type-checks `src/**/*.test.ts`, declaration output in `.tsbuild/`). Both extend `@consent/config/tsconfig.base.json`. A new workspace adds both to the root `tsconfig.json` references, which is what `yarn typecheck` (`tsc -b`) runs.
- The base config uses `module: NodeNext`, so relative imports in `src` end in `.js`. dashboard-web overrides this with `Bundler` resolution.
- Internal packages export `{ types: dist/*.d.ts, source: src/*.ts, default: dist/*.js }`. Vitest resolves the `source` condition (`resolve.conditions` and `ssr.resolve.conditions` / `externalConditions` set to `['source']` in each workspace `vitest.config.ts`; copy an existing one), so tests run without building first. `tsc -b` builds referenced packages in order, and each build keeps its `tsbuildinfo` inside `dist/`, so deleting `dist/` resets it.
- Tests live next to the code as `src/**/*.test.ts`. Each workspace has a `vitest.config.ts` (`defineProject`) and the root `vitest.config.ts` lists `projects: ['packages/*', 'apps/*']`. dashboard-web switches its project to `jsdom`.
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

The section below is generated by GitNexus, an **optional** local code-graph tool. `.gitnexus/` and `.claude/` are git-ignored and do not exist in a fresh clone, so contributors without the tool can skip it: the project rules are the ones above.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **c15t** (2812 symbols, 7745 relationships, 218 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/c15t/context` | Codebase overview, check index freshness |
| `gitnexus://repo/c15t/clusters` | All functional areas |
| `gitnexus://repo/c15t/processes` | All execution flows |
| `gitnexus://repo/c15t/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
