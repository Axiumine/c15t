# c15t Consent Platform

[![CI](https://github.com/Axiumine/c15t/actions/workflows/ci.yml/badge.svg)](https://github.com/Axiumine/c15t/actions/workflows/ci.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Axiumine/c15t/badge)](https://scorecard.dev/viewer/?uri=github.com/Axiumine/c15t)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/16093/badge)](https://www.bestpractices.dev/projects/16093)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](./LICENSE)

Self-hosted cookie-consent backend and dashboard for websites that run on the same server.

- One **consent-api** service runs a [c15t](https://c15t.com/docs/self-host) backend for every registered website. It stores consent records, serves the banner configuration and keeps the audit trail.
- A private **dashboard** shows each website's consent data. It is a React single-page app with its own API, and it is never indexed by search engines. **Admins** see every website, create websites and user accounts, and decide which websites each user can see. **Users** log in with credentials an admin gave them, see only the websites assigned to them, and have read-only access.
- Everything lives in a single **PostgreSQL** database on the existing **Patroni cluster** (5 nodes, etcd). The services run on **Node.js 26 LTS**, managed with **Yarn 4**. They sit behind **nginx** and **Cloudflare** and run under **systemd**. There is no Docker.

> Status: pre-1.0 (0.x, first release `v0.1.0`). The three services and the database layer are implemented and tested, but there is no 1.0 yet, so expect breaking changes between 0.x versions (see [`CHANGELOG.md`](./CHANGELOG.md)). Contributing: [`CONTRIBUTING.md`](./CONTRIBUTING.md). Reporting a vulnerability: [`SECURITY.md`](./SECURITY.md). Engineering rules for contributors and Claude Code: [`CLAUDE.md`](./CLAUDE.md).

---

## Architecture

```
 Browser                    Cloudflare edge             This server (nginx + systemd, no Docker)
 ───────                    ───────────────             ───────────────────────────────────────────────
 shop.example.com page ───► shop.example.com ─────────► nginx vhost shop.example.com
   GET  /api/c15t/init        proxied (orange cloud)       /            -> shop's own app
   POST /api/c15t/subjects    cache bypass /api/c15t/*     /api/c15t/*  -> upstream /s/shop/* ───────┐
                              adds CF-IPCountry                                                       │
 blog.example.org page ───► blog.example.org ─────────► nginx vhost blog.example.org                  │
                                                           /api/c15t/*  -> upstream /s/blog/* ───────┤
                                                                                                      ▼
 Website server code (SSR, jobs) ──── CONSENT_API_URL/s/<siteKey> ───────────────────► consent-api (Node 26 + Hono)
                                                                                       CONSENT_API_HOST:PORT
                                                                                       default 127.0.0.1:4100
                                                                                       c15tInstance per site
                                                                                            │ rw schema c15t
                                                                                            ▼
 Admin / user ────────────► dashboard.example.com ────► nginx vhost dashboard.example.com   PostgreSQL
                              (noindex)                    /       -> static SPA files      Patroni cluster,
                                                           /api/*  -> dashboard-api ──────► primary via DNS
                                                                      (Node 26 + Hono)      app rw, c15t read-only
                                                                      DASHBOARD_API_HOST:PORT
                                                                      default 127.0.0.1:4200
```

| Component | Tech | Runs as | Listens on (configurable) | Public? |
|---|---|---|---|---|
| consent-api | Node.js 26 LTS, Hono (`@hono/node-server`), `@c15t/backend` v3, `@effect/sql-pg` | systemd `c15t-consent-api` | `CONSENT_API_HOST:CONSENT_API_PORT`, default `127.0.0.1:4100` | **No**. Reached only through the nginx vhost of each site |
| dashboard-api | Node.js 26 LTS, Hono, Better Auth (admin plugin), Drizzle + postgres.js | systemd `c15t-dashboard-api` | `DASHBOARD_API_HOST:DASHBOARD_API_PORT`, default `127.0.0.1:4200` | Only as `dashboard.example.com/api/`, through nginx |
| dashboard-web | React 19 + Vite, TanStack Router/Query, Tailwind + shadcn/ui, Recharts | static files, served by nginx | none | Yes, `dashboard.example.com` (noindex) |
| database | Existing Patroni cluster: 5 PostgreSQL nodes, etcd as the DCS | Patroni | primary through an internal DNS name (+ optional replica name), from `DATABASE_URL_*` | No |

---

## Decisions

### D1. Websites reach consent-api over a private path, and there is no public consent hostname

**Question:** can websites call this service from localhost, so that consent traffic does not open a new public connection?

**Answer: yes**, for every call this platform controls. There is one limit, set by how cookie consent works:

1. **Website server code** (SSR prefetch of `/init`, `consents.check` with `@c15t/node-sdk`, background jobs) calls `CONSENT_API_URL` (default `http://127.0.0.1:4100`) directly. That is loopback, with no DNS, no TLS and no public network.
2. **The visitor's browser** has to send its consent choice itself, because the banner runs on the visitor's machine. The browser cannot reach the server's localhost. Instead it calls **the website's own origin** (`https://shop.example.com/api/c15t/...`). Cloudflare forwards the request to nginx, and nginx proxies it to consent-api over the private path. The browser already holds an HTTP/2 or HTTP/3 connection to that hostname, at the Cloudflare edge, for the page itself, so the consent requests are multiplexed on it. The result is no new DNS lookup, no new TCP or TLS handshake and no third-party domain.

**Decision:**

- consent-api binds to `CONSENT_API_HOST:CONSENT_API_PORT` (default `127.0.0.1:4100`) and has **no public hostname**. The address may be a private LAN address. It is never a wildcard (`0.0.0.0`, `::`) or public address, and env validation rejects both.
- Each website's vhost gets an `/api/c15t/` location. It rewrites to `/s/<siteKey>/` on the nginx upstream `c15t_consent_api`, which is rendered from the same env values. The `siteKey` is hard-coded in that vhost, so the browser never chooses the tenant.
- Frontends use the same-origin `backendURL: '/api/c15t'`. Server code uses `CONSENT_API_URL`.

**Why:** there is no extra public connection, as the question asked. Requests are same-origin, so no CORS preflights are needed. Ad blockers and privacy tools cannot block a consent domain, because there is none, and consent traffic never touches a third-party domain. consent-api has a smaller attack surface, since it cannot be reached from the internet. The tenant is chosen by trusted proxy config, never by browser input.

**Consequences and requirements:**

- Cloudflare sits between the browser and nginx (D7) and reaches the origin over its own pooled connections. nginx restores the real visitor IP from `CF-Connecting-IP` with the `real_ip` module, which trusts only Cloudflare ranges, and forwards it as `X-Forwarded-For`. Country comes from Cloudflare's `CF-IPCountry`, passed through unchanged. c15t needs both, for IP masking and for jurisdiction rules.
- consent-api trusts forwarded headers only from peers in `CONSENT_API_TRUSTED_PROXIES` (default loopback). It strips them from any other peer. It also checks that `Host` is in the site's `domains`, and returns 404 if it is not. `trustedOrigins` for each instance still lists the site's domains (what it does and does not do is in the Security notes).
- **List every domain as a bare host name, without a port.** The nginx snippet forwards `$host`, which never carries a port, so a `shop.example.com:8443` entry can never pass the `Host` check and every request for that site gets a 404. The site form still accepts a `host:port` domain (validation allows it, and c15t would match it), but the runtime never matches it behind the shipped snippet, so a site on a non-standard port does not work.
- **When bound to a LAN address**, the path is no longer loopback (settings: Configuration, Network). `@c15t/node-sdk` refuses plain `http:` with an API key for non-loopback hosts, so key-protected SDK calls must run on the consent-api host or go through TLS.
- Adding a website means adding two lines to its nginx vhost. The dashboard generates them. A website on another server (outside the LAN) would need a public fallback hostname, which is out of scope for now.

### D2. One PostgreSQL database, two schemas, two roles

- Schema `c15t` holds consent data. It is created and migrated only by `@c15t/cli self-host migrate`. Role `c15t_api` owns it and has read-write access.
- Schema `app` holds dashboard data: auth tables, `site`, `site_member` and `admin_audit`. Role `dashboard` owns it, and dashboard-api connects as that role.
- `dashboard` gets `SELECT` only on `c15t.*`. `c15t_api` gets `SELECT` only on `app.site` (the site registry).
- Why: one backup target and one engine, with the access boundaries enforced by Postgres itself.

### D3. One c15t instance per website, isolated by `tenantId`

- c15t's recommended multi-tenant pattern is one instance per tenant. Each site gets `tenantId = siteKey`, `requireTenantId: true`, and `trustedOrigins` set to the site's domains.
- All sites share the `c15t` schema, and every row is tagged with its tenant. That makes it possible to aggregate data across sites for admins, and to filter it per site for users.
- Instances are built lazily and cached. When a site row is inserted or updated, a **database trigger** on `app.site` (migration `0001_guards`) sends `NOTIFY site_changed, '<siteKey>'` as part of the same transaction. dashboard-api does not send it. consent-api `LISTEN`s on the channel and disposes the stale instance.

### D4. The dashboard reads c15t tables directly

- c15t v3 exposes no HTTP endpoints for listing consents or stats. Its admin API covers subject lookup by `externalId`, consent checks, legal-document publishing and experiment summaries.
- dashboard-api therefore queries the `c15t` schema through its read-only role. It uses Drizzle types generated by `drizzle-kit pull`, which are regenerated after every c15t upgrade.
- For the few endpoints c15t does expose (consent checks, legal-document publishing, experiment summaries), dashboard-api **will use** `@c15t/node-sdk` through `CONSENT_API_URL`. **It does not do so yet**: it reads the `c15t` schema directly today, there is no SDK dependency and no such call, so `CONSENT_API_URL` and `C15T_ADMIN_API_KEY` are optional for dashboard-api and reserved for that future use. Website servers use the SDK themselves (see "Adding a website").

### D5. Admins create every credential, and there is no self sign-up

- Better Auth email + password with `disableSignUp: true`, plus the `admin` plugin for roles (`admin`, `user`), creating users, resetting passwords, bans and revoking sessions.
- An admin creates a user, and the system generates a password that is shown **once**. The user must change it on first login.
- The first admin is created from the CLI (`yarn admin:create`).

### D6. Consent records are never deleted from the dashboard

- Consent records are legal proof. When an admin disables a site, the platform stops serving it and keeps its data. Retention and purging are a separate, explicit job, still to be designed (see Open questions).

### D7. Hosting: Cloudflare, then nginx, then systemd (no Docker)

- **Cloudflare** proxies every website and the dashboard (orange cloud), with SSL mode **Full (strict)** and a Cloudflare Origin CA certificate on nginx.
- **nginx** is the only reverse proxy, and it also serves the dashboard's static files. The upstreams `c15t_consent_api` and `c15t_dashboard_api` are rendered from env by `infra/deploy.sh`. A single shared snippet, `/etc/nginx/snippets/c15t.conf`, holds the proxy settings for website vhosts, and each site's vhost adds two lines. The files are described in [`docs/nginx.md`](./docs/nginx.md).
- **systemd** runs consent-api and dashboard-api as the `c15t` system user. Secrets live in `/etc/c15t-platform/*.env` (mode 0600), loaded through `EnvironmentFile=`. PostgreSQL is the existing Patroni cluster (D9).
- **Releases:** `infra/deploy.sh` builds into `/opt/c15t-platform/releases/<git sha>` and then switches the `current` symlink atomically.
- **Origin lock-down:** ports 80 and 443 accept traffic only from Cloudflare IP ranges (firewall), and Authenticated Origin Pulls are enabled. Without this, anyone who hits the origin IP directly could spoof `CF-Connecting-IP` or `CF-IPCountry`. A systemd timer refreshes the ranges weekly (`infra/nginx/update-cloudflare-ips.sh`, which regenerates both the nginx `real_ip` config and the firewall set). The firewall set must also be made to survive a reboot, once (see [`docs/nginx.md`](./docs/nginx.md)).
- **Cloudflare zone rules for every site:**
  - A **Cache Rule** that bypasses the cache for paths starting with `/api/c15t/`. `/init` depends on the visitor's country, so a cached copy would apply the wrong jurisdiction's rules. consent-api also sends `Cloudflare-CDN-Cache-Control: no-store` as a backstop.
  - **WAF and bot rules must not challenge `/api/c15t/*`.** The banner calls these routes with `fetch`, so a challenge makes the call fail silently and the consent is lost.
  - **Rocket Loader** must not defer the banner script (`data-cfasync="false"`), because the banner must load before any trackers.
  - **Zaraz** consent stays off, so visitors never see two banners.
  - Enable the **"Add visitor location headers"** Managed Transform if you need region-level rules (US states, for example). It adds `cf-region-code`.

### D8. Node.js 26 LTS as the runtime, Yarn 4 as the package manager

- **Runtime: Node.js 26 LTS** for every service, CLI and test. It is pinned by `engines.node: ">=26 <27"` and `.nvmrc`. c15t (`@c15t/node-sdk` requires Node 20.19+) targets Node.
- **Yarn 4** runs through Corepack, and its version is pinned in `packageManager`. It uses Yarn workspaces (`apps/*`, `packages/*`, `workspace:*`), `nodeLinker: node-modules` (no Plug'n'Play) and `yarn install --immutable` in deploys. Scripts run across workspaces with `yarn workspaces foreach` (`-Apt` for builds, `-Api` for dev). There is no Turborepo. This is the same toolchain as the other Axiumine packages.
- **Tests:** Vitest under Node plus Playwright. **Build:** `tsc -b` for the APIs and packages, `vite build` for dashboard-web.
- Peer dependencies, `.env` loading in dev and Corepack on Node 25 and later are covered in `CLAUDE.md`, "Toolchain gotchas".

### D9. PostgreSQL runs on the existing Patroni cluster (5 nodes, etcd)

- **Apps never talk to etcd or Patroni.** The current leader is published under an **internal DNS name** (for example `pg-primary.<internal zone>`), which is repointed on failover. Apps get a **primary URL** that uses this name and, optionally, a **replica URL** for heavy read-only queries. No app uses a node's own name or IP, HAProxy, or a multi-host URL.
- **The primary receives** consent saves, the dashboard's `app` schema, all migrations (c15t and drizzle) and `LISTEN`/`NOTIFY`. `NOTIFY` is never delivered on replicas, so the consent-api listener must connect to the primary.
- **The optional replica URL** (`DATABASE_URL_DASHBOARD_REPLICA`) serves only dashboard-api's stats, search and CSV export over `c15t.*`. Authz and every `app.*` read always use the primary, so a revoked membership takes effect immediately and never waits on replication lag.
- **Failover handling with DNS:**
  - After a failover, DNS points at the new leader, but connections that are already open still go to the old node. They are caught by the error handling below and by a capped connection lifetime (postgres.js `max_lifetime` of a few minutes).
  - Keep the record's TTL low (≤ 30 s), and never pin the resolved IP anywhere. Node resolves the name on every new connection. Check that the host resolver (systemd-resolved, nscd) honors the TTL.
  - Where the driver supports it, primary connections require `target_session_attrs=read-write`. Then a stale DNS answer makes the connection fail fast, instead of handing the app a connection to a replica. **Not every client can do this**, so the table below states exactly what each one does.
  - Pools discard broken connections and reconnect. Requests that were in flight fail with 503. Retry reads automatically, but never retry writes blindly. A connection that lands on a demoted node fails with `25006 read_only_sql_transaction`. Treat that as a failover signal and drop the connection. No pool may `process.exit()` on an idle-client error, because a planned switchover would restart the service.
  - The consent-api listener reconnects with backoff and runs `LISTEN` again. Then it disposes **all** cached c15t instances, because any `NOTIFY` sent during the failover is lost. It uses TCP keepalives and a periodic ping, so it notices quickly when the old primary goes away.
- **What each client does** (the settings are in `packages/db/src/pool.ts`, `apps/consent-api/src/listener-config.ts` (the ping is in `listener-watch.ts`) and `apps/consent-api/src/instance-database.ts`):

  | Client | Driver | `target_session_attrs` | Connect timeout | TCP keepalive | Connection lifetime |
  |---|---|---|---|---|---|
  | dashboard-api primary pool, `yarn db:migrate`, `yarn admin:create`, consent-api site registry | postgres.js | `read-write` | 5 s | 30 s | `max_lifetime` 5 min |
  | dashboard-api replica pool (`db.analytics`) | postgres.js | `prefer-standby` | 5 s | 30 s | 5 min |
  | consent-api `LISTEN` connection | postgres.js | `read-write` | 5 s | 30 s, plus a periodic ping | none (one long-lived connection, reconnects with backoff) |
  | consent-api per-site c15t pools | `@effect/sql-pg` 4.0.0 | **none**: the driver has no such option | 5 s | 30 s, through a custom socket (not for a `?host=` unix-socket URL) | `connectionTTL` 5 min |
  | `yarn c15t:plan` and `yarn c15t:migrate` | c15t CLI | none (c15t's `database: { dialect, url, schema }` shortcut, default pool) | default | default | one-shot, run against the primary URL only |

  Because the c15t pools cannot refuse a replica, a connection that is still on a demoted node is caught in two ways: the 5-minute lifetime, and the error handling (`25006`, `57P01`, connection resets). On such an error the site registry drops that site's instance (5 s cooldown after creation), retries a `GET` or `HEAD` once on a fresh instance, never retries a write, and answers `503` with `Retry-After: 1`.
- **Durability:** consent records are legal proof. With asynchronous replication, a failover can lose the last committed consents. Patroni `synchronous_mode: true` prevents that, at some write-latency cost (see Open questions).
- **Connection budget:** every write lands on one primary. Add up all pools: per-site c15t instances × pool size, plus dashboard-api, listener and migrations. The total must stay well below the primary's `max_connections`. Keep each c15t instance's pool at 2–3, and revisit a shared client layer as the number of sites grows. Do not put PgBouncer in transaction mode in front of c15t, because prepared statements break.
- **Cluster config and backups:** create roles and schemas once on the primary, and they replicate to the other nodes. Manage `pg_hba` entries through Patroni's config (`postgresql.pg_hba` in the DCS), not by editing `pg_hba.conf` on a node, because Patroni overwrites that file. The cluster's existing backup tooling (pgBackRest, WAL-G, ...) must include this database. The steps are in [`docs/database-setup.md`](./docs/database-setup.md), "Production on Patroni". Use `sslmode=verify-full` when nodes are on other hosts, and read "TLS to PostgreSQL" below.
- **TLS to PostgreSQL.** Two drivers read the URL differently, so know what each one does:
  - postgres.js (dashboard-api, the registry and `LISTEN` in consent-api, migrations) honours `sslmode`: `require` encrypts **without** verifying the certificate, `verify-full` verifies it. It ignores `sslrootcert=<file>` and sends it to Postgres as a startup parameter, which Postgres rejects. So **never put `sslrootcert` in a URL**.
  - `@effect/sql-pg` (the c15t pools in consent-api) turns `require`, `verify-ca` and `verify-full` into plain TLS with Node's default trust store, so it **verifies** the certificate even for `require`.
  - If the cluster uses a private or self-signed CA, give Node the CA file for both drivers with `NODE_EXTRA_CA_CERTS=/etc/ssl/c15t/ca.pem` in `consent-api.env` and `dashboard-api.env` (keep the file outside `/etc/c15t-platform`, which the units hide from themselves, and make it readable by user `c15t`). Without it, `sslmode=require` looks healthy on the registry and `/status` but every c15t query fails verification and consent saves return 503.

### D10. Dashboard: a React single-page app (Vite) plus a Hono API, with no SSR and no SEO

- The dashboard is private, sits behind a login and must never be indexed. Server rendering and SEO therefore bring nothing.
- **dashboard-web:** React 19 + Vite, TanStack Router + Query, react-hook-form + zod, Tailwind + shadcn/ui and Recharts. It builds to static files that nginx serves. Hashed `/assets/*` are cached for a year at Cloudflare and in the browser, and `index.html` is `no-cache`.
- **dashboard-api:** Hono on Node 26. Better Auth is mounted at `/api/auth/*`, and the JSON API lives under `/api/*`. It binds to `DASHBOARD_API_HOST:DASHBOARD_API_PORT` (default `127.0.0.1:4200`), under the same rules as consent-api.
- **Same origin:** the UI and the API are both on `dashboard.example.com`. Sessions are httpOnly cookies, there is no CORS, and Better Auth's origin check guards against CSRF.
- **Typed end to end:** dashboard-api exports `type AppType`, and the UI calls it through the Hono RPC client `hc<AppType>('/api')`. Shared zod schemas live in `@consent/shared`.
- **Authorization lives only in the API** (`authz.ts` middleware on each route group, plus a route coverage test). Route guards in the UI are only for UX.
- **Not indexed:** `X-Robots-Tag: noindex, nofollow` on every response, including the API and error pages, a `robots.txt` with `Disallow: /`, and a robots `<meta>` tag in `index.html`. There is no sitemap and there are no Open Graph tags.
- **Why not Next.js:** one server framework (Hono) serves both services. The explicit API boundary keeps authz easy to audit and test, with no server actions acting as hidden public endpoints. The UI deploys as static files, and there is less upgrade churn.

### D11. `@axiumine/koa-utils` is not used, for now

- Database access uses c15t's own driver in consent-api, and Drizzle + postgres.js in dashboard-api.
- Reasons, based on v7.1.0:
  - c15t accepts only a URL or an Effect SQL client layer, so it could never use the package's `pg` pool.
  - The pool's `error` handler calls `process.exit(-1)`. Every Patroni switchover would therefore restart the service and drop the requests in flight.
  - The pool is created at import time with `dotenv.config()` and a single host and credential set. That rules out separate primary and replica pools, and it offers no `ssl`, keepalive, timeout or lifetime options, which D9 needs.
  - The package targets Koa + GraphQL + MongoDB/Redis. The dashboard is Hono + Better Auth on Postgres.
- Revisit this when the package offers a `createPgPool(options)` factory that passes options through to `pg.Pool`, has no `process.exit` and does no env loading at import time. Even then, `pg` lacks `target_session_attrs` (D9).

---

## Roles and permissions

| Capability | admin | user |
|---|---|---|
| See websites | all | assigned only |
| View consent stats and records | all websites | assigned websites |
| Export consent records (CSV) | all websites | assigned websites |
| Create, edit and disable websites | yes | no |
| Create users and generate or reset passwords | yes | no |
| Ban users and revoke sessions | yes | no |
| Assign users to websites | yes | no |
| View the admin audit log | yes | no |
| Change own password | yes | yes |

dashboard-api enforces every check (`apps/dashboard-api/src/authz.ts`). If a user requests a website they are not assigned to, they get a 404. If a user calls an admin route, they get a 403.

## Data model (`app` schema)

| Table | Key columns |
|---|---|
| `user`, `session`, `account`, `verification` | Better Auth tables. `user.role` is `admin` or `user`. `user.banned`, `banReason`, `banExpires` and `user.mustChangePassword` |
| `rate_limit` | Better Auth's login rate-limit counters (`key`, `count`, `lastRequest`), kept in the database so they survive restarts |
| `site` | `id`, `key` (immutable, also the c15t `tenantId`), `name`, `domains text[]` (non-empty, no `*`), `policyPreset`, `status` (`active` / `disabled`), timestamps |
| `site_member` | `userId`, `siteId`, `createdAt`. Primary key (`userId`, `siteId`) |
| `admin_audit` | `actorId`, `actorEmail` (a snapshot, so deleting a user never rewrites history), `action`, `targetType`, `targetId`, `metadata jsonb`, `ip`, `createdAt`. Append-only: database triggers reject `UPDATE`, `DELETE` and `TRUNCATE` |

The c15t schema includes `subject`, `consent`, `consentPolicy`, `consentPurpose`, `domain`, `runtimePolicyDecision`, `auditLog` and the `c15t_migrations` ledger. Upstream owns it, so do not change it by hand.

## Dashboard

### Screens (dashboard-web)

| Route | Who | Content |
|---|---|---|
| `/login`, `/account` | all | sign in, change password (forced on first login) |
| `/sites` | all | list of accessible websites |
| `/sites/$key` | all (with access) | consent volume over time, opt-in rate per purpose, breakdown by jurisdiction |
| `/sites/$key/consents` | all (with access) | search by subject ID or date range, record detail, CSV export |
| `/sites/$key/setup` | admin edits, users read | nginx lines, frontend snippet, domains, policy preset |
| `/admin`, `/admin/overview` | admin | all websites side by side for the same period: consents, subjects, opt-in rate and a ranking by website. `/admin` redirects here |
| `/admin/users` | admin | create users (one-time password), edit name and role, assign websites, reset passwords, ban users, revoke sessions |
| `/admin/sites` | admin | create, edit and disable websites |
| `/admin/audit` | admin | admin action log |

### API (dashboard-api)

| Method and path | Guard | Purpose |
|---|---|---|
| `/api/auth/*` | none (Better Auth) | sign in, sign out, change password, session |
| `GET /api/health` | none | liveness and primary DB ping |
| `GET /api/me` | session | current user, role, `mustChangePassword` |
| `GET /api/sites` | session | accessible websites |
| `GET /api/sites/:siteKey` | site access | site detail and setup snippets |
| `GET /api/sites/:siteKey/stats?from&to` | site access | volume, opt-in rate per purpose, jurisdictions (analytics pool) |
| `GET /api/sites/:siteKey/consents?subject&from&to&cursor&limit` | site access | record search with cursor pagination |
| `GET /api/sites/:siteKey/consents.csv?from&to` | site access | streamed CSV export |
| `GET /api/admin/sites`, `POST /api/admin/sites`, `PATCH /api/admin/sites/:siteKey` | admin | list, create, edit and disable websites (a disabled site is never deleted). A database trigger on `app.site` sends `NOTIFY site_changed` when the change commits |
| `GET /api/admin/users`, `POST /api/admin/users`, `PATCH /api/admin/users/:id`, `PUT /api/admin/users/:id/sites`, `POST /api/admin/users/:id/{reset-password,ban,unban,revoke-sessions}` | admin | user management (create, edit name and role, assign websites, credentials, bans, sessions), all audited |
| `GET /api/admin/audit?cursor` | admin | admin action log |

The admin overview screen has no endpoint of its own: it calls the per-site `stats` route for every website. Changing a password through `/api/auth/change-password` revokes the user's other sessions, and a new password equal to the current one is refused with `400 PASSWORD_UNCHANGED`. `from` and `to` accept years 0001 to 9999 only. A forged cursor, a NUL character in a parameter and a Postgres class-22 (data exception) error all return `400 VALIDATION_ERROR`, never a 500.

## Configuration

Development uses `.env` (from `cp env.example .env`; the repository ships the template without the leading dot). Yarn injects it into every `yarn <script>`. Production uses `/etc/c15t-platform/consent-api.env` and `dashboard-api.env` (owner `c15t`, mode 0600) and no `.env` files.

### Network

| Variable | Used by | Default | Purpose |
|---|---|---|---|
| `CONSENT_API_HOST` | consent-api, nginx upstream | `127.0.0.1` | Bind address. Must be loopback or private LAN (RFC 1918, `100.64.0.0/10`, `fc00::/7`). `0.0.0.0`, `::` and public IPs are rejected |
| `CONSENT_API_PORT` | consent-api, nginx upstream | `4100` | Bind port (1024–65535) |
| `CONSENT_API_TRUSTED_PROXIES` | consent-api | `127.0.0.1/32,::1/128` | CIDRs allowed to send `X-Forwarded-*` / `CF-*` headers. These headers are stripped from every other peer |
| `CONSENT_API_INSTANCE_POOL_MAX` | consent-api | `2` | Postgres connections per site instance (1–3). Total: sites × this |
| `CONSENT_API_REGISTRY_POOL_MAX` | consent-api | `2` | Connections for the site registry reads (1–3) |
| `CONSENT_API_DB_PREPARE` | consent-api | `true` | Set `false` only behind PgBouncer in transaction mode (prepared statements break there) |
| `CONSENT_API_URL` | website servers; dashboard-api (optional, reserved) | `http://127.0.0.1:4100` | How callers reach consent-api. Optional in dashboard-api, reserved for future SDK calls and unused today: leave it out of `dashboard-api.env` (D4) |
| `DASHBOARD_API_HOST` | dashboard-api, nginx upstream, Vite dev proxy | `127.0.0.1` | Bind address, same rules as `CONSENT_API_HOST` |
| `DASHBOARD_API_PORT` | dashboard-api, nginx upstream, Vite dev proxy | `4200` | Bind port |
| `DASHBOARD_WEB_DEV_PORT` | Vite dev server (dev only) | `5173` | Dev UI port. The dev server binds `127.0.0.1` and proxies `/api` to dashboard-api |

To serve LAN hosts, set `CONSENT_API_HOST` to the server's private IP and restrict `CONSENT_API_PORT` in the firewall to those hosts. Then add nginx's address to `CONSENT_API_TRUSTED_PROXIES` (if it is not loopback), and point `CONSENT_API_URL` at the same address. See the D1 consequences for the SDK TLS caveat.

### Secrets and services

| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_URL_C15T` | consent-api, c15t CLI | Postgres URL for role `c15t_api`, primary DNS name |
| `DATABASE_URL_DASHBOARD` | dashboard-api | Postgres URL for role `dashboard`, primary DNS name |
| `DATABASE_URL_DASHBOARD_REPLICA` | dashboard-api (optional) | Same role on the replica endpoint, used only for c15t stats, search and export (D9) |
| `C15T_ADMIN_API_KEY` | consent-api (required, at least 16 characters), website servers; dashboard-api (optional, reserved) | Bearer key for the c15t admin endpoints. Server-side only, never sent to a browser. Optional in dashboard-api, reserved for future SDK calls and unused today: leave it out of `dashboard-api.env` (D4) |
| `BETTER_AUTH_SECRET` | dashboard-api | at least 32 characters, e.g. the output of `openssl rand -hex 32` |
| `BETTER_AUTH_URL` | dashboard-api | public dashboard origin, e.g. `https://dashboard.example.com` (dev: `http://127.0.0.1:5173`). It must equal the exact origin typed in the browser (scheme, host and port). On a mismatch the origin check answers 403, and the login form says the address is "not the dashboard's official address". Only a `BANNED_USER` 403 shows "This account is disabled" |
| `NODE_EXTRA_CA_CERTS` | consent-api, dashboard-api (optional) | Path of a CA bundle that Node trusts in addition to its own, for a PostgreSQL cluster with a private CA (D9, "TLS to PostgreSQL"). A Node setting, not read by the apps' env modules |

dashboard-web needs no runtime configuration. It calls the same-origin `/api`.

## Getting started

These steps set up a development machine. To install the platform on a server, see Production below.

### Prerequisites

- Node.js 26 LTS at `/usr/bin/node` (from NodeSource, for example; `engines.node` and `.nvmrc` pin it), then `npm install -g corepack && corepack enable` for Yarn 4 (Node 26 does not bundle Corepack)
- Network access to the Patroni cluster through its internal DNS names: the primary, and optionally the replicas, plus `pg_hba` entries for roles `c15t_api` and `dashboard` added through the Patroni config
- nginx 1.25.1 or newer (`http2 on;`) with `ngx_http_realip_module` (included in the Debian and Ubuntu packages)
- Every website and the dashboard on Cloudflare (proxied), plus a firewall (nftables or ufw)

### 1. Get the source, install and configure

```bash
git clone https://github.com/Axiumine/c15t.git
cd c15t
npm install -g corepack   # Node 26 does not bundle Corepack
corepack enable
yarn install
cp env.example .env
```

### 2. Database

The full walkthrough (roles, grants, Patroni notes, a local development database) is in [`docs/database-setup.md`](./docs/database-setup.md). In short: run [`infra/postgres/init.sql`](./infra/postgres/init.sql) once on the primary (database, roles, schemas, grants; the `psql` command is in step 1 of that document), put the two role passwords into `DATABASE_URL_C15T` (role `c15t_api`) and `DATABASE_URL_DASHBOARD` (role `dashboard`) in the file you copied in step 1, and fill in `C15T_ADMIN_API_KEY`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` (step 2 of that document has the exact lines). Then run the migrations and create the first admin:

```bash
yarn c15t:plan                              # review the c15t migration plan
yarn c15t:migrate                           # apply it
yarn db:migrate                             # dashboard (app schema) migrations
yarn db:pull-c15t                           # regenerate the read-only types for the c15t schema (committed; rerun after a c15t upgrade)
yarn admin:create --email you@example.com   # prints a one-time password
```

### 3. Develop

```bash
yarn dev                                    # consent-api, dashboard-api and Vite; UI at http://127.0.0.1:5173
yarn typecheck && yarn lint && yarn test    # tsc -b, biome check, vitest run
yarn lint:eslint                            # ESLint gate (run yarn typecheck first)
yarn test:e2e                               # Playwright
```

## Production

No Docker. `infra/deploy.sh install` prepares the host (the `c15t` user, directories, empty env files, systemd units), and `infra/deploy.sh` builds, migrates, switches `current`, restarts and health-checks (D7). The order of the steps, upgrades, rollbacks, uninstalling and verifying a signed release are in [`docs/installation.md`](./docs/installation.md). The nginx files, the dashboard vhost, the Cloudflare `real_ip` file, the firewall allowlist and the nginx tests are in [`docs/nginx.md`](./docs/nginx.md).

## Adding a website

1. **Dashboard, Admin, Sites, New.** Enter a name, a `siteKey` (e.g. `shop`, which cannot be changed later), the domains (`shop.example.com`, `www.shop.example.com`) and a policy preset. Enter each domain as a bare host name, without a port (see D1).
2. **Add two lines to that website's nginx vhost.** The dashboard shows them. Then run `sudo nginx -t && sudo systemctl reload nginx`.

   ```nginx
   server {
       server_name shop.example.com www.shop.example.com;
       set $c15t_site shop;
       include snippets/c15t.conf;
       # ...existing site config
   }
   ```

3. **Set up the Cloudflare zone** (see D7). Add the Cache Rule that bypasses `/api/c15t/*`. Make sure no WAF or bot rule challenges that path. If Rocket Loader is on, exclude the banner script.
4. **Point the website's banner at the same origin.**
   - Framework packages (`@c15t/react`, `@c15t/nextjs`, ...): set `backendURL: '/api/c15t'`.
   - No framework (WordPress, static HTML): `<script src="/api/c15t/c15t.js" data-cfasync="false" data-categories="measurement,marketing"></script>`. The Setup screen of the website shows this tag and tells the operator to list the categories the site really uses.
   - **Declare the categories your site uses.** Use a comma-separated list of c15t's category names: `functionality`, `experience`, `measurement`, `marketing` (`necessary` is always included). The tag above lists `measurement,marketing` only as a starting point, because sites do not store categories: change `data-categories` to match your page. c15t 3.1.0 infers the categories from the page itself (its gated scripts and this attribute), so a page that declares none records only `necessary`: "Accept All" is stored, but the opt-in rate per purpose stays empty in the dashboard. A framework package needs the same categories declared in its own configuration.
   - Server-side code: `createC15tClient({ baseUrl: `${CONSENT_API_URL}/s/shop`, apiKey })`.
5. **Check it.** `curl -sI https://shop.example.com/api/c15t/status` should return 200 with `cf-cache-status: BYPASS` or `DYNAMIC`.
6. **Assign users** to the website in Admin, Users.

## Security notes

The threat model, what is not protected and the known gaps are in [`docs/security-model.md`](./docs/security-model.md). The network rules are in D1 (consent-api is never public, and bind addresses are loopback or private LAN), D7 (the origin accepts traffic only from Cloudflare) and D10 (the dashboard is never indexed). The rest:

- The dashboard is the only new public hostname. You can add **Cloudflare Access** (Zero Trust) in front of it as a second login layer. A strict CSP allows only same-origin scripts, and dashboard-web has no secrets at all.
- `trustedOrigins` must not be empty and must not contain `*` or `*.example.com`. We enforce that when a site is saved and again when its instance is built. In the pinned c15t 3.1.0 the list **only drives the CORS response headers**: an empty list means no cross-origin browser may read the answers, and `*` or `*.example.com` would widen that to every origin or every subdomain. It does **not** authenticate consent saves: a client that is not a browser can send any `Origin`, so the public consent endpoints accept writes from anyone who can reach them (see `docs/security-model.md`).
- c15t masks IP addresses by default. Keep it that way unless legal advice says otherwise.
- Login is rate-limited. Sessions are httpOnly, Secure, `SameSite=Lax` cookies, and Better Auth checks the request origin. Admin actions are audited.
- `C15T_ADMIN_API_KEY` stays on the server and browsers never receive it. The cluster's existing backups must include this database (D9).

## Status and what is next

Done and covered by tests (unit, PostgreSQL integration and Playwright end to end):

1. **Foundation:** the monorepo (Yarn 4 workspaces, Node 26), env validation with the network rules, Postgres roles and schemas, c15t migrations, and consent-api serving one c15t instance per site behind the nginx snippet.
2. **Access control:** dashboard-api with Better Auth, the admin bootstrap CLI, user management with one-time passwords, site management, memberships, the audit log and the route coverage test; the dashboard-web login, account and admin screens.
3. **Consent views:** per-site overview charts, record search, CSV export and the admin cross-site overview.
4. **Hardening:** the authz test suite (a user cannot read another site's data), the Playwright suite, login rate limits, the `/status` and `/api/health` endpoints, and `infra/deploy.sh` with rollback.

Still open:

- A 1.0 release. Until then, 0.x minor versions may contain breaking changes (see `CHANGELOG.md`; releases follow `CONTRIBUTING.md`).
- A retention job for consent records. It waits for the legal decision under Open questions.
- Monitoring on `/status` and `/api/health`, and the cluster backups (D9). Both are the operator's job.
- Calling the c15t admin endpoints from dashboard-api through `@c15t/node-sdk` (D4). Nothing needs it yet.

## Open questions

- How long to keep consent records, and whether to purge or anonymize after that (a legal decision).
- The internal DNS names (the primary, and the replicas if a replica name exists) and the TTL of the primary record.
- Whether the cluster runs Patroni `synchronous_mode`. Without it, a failover can lose the last few consent saves.
- The primary's `max_connections`, and how much of it this platform may use.
- Which policy presets the websites need (EU opt-in only, or also US opt-out and others).
- Whether users should edit banner texts and translations, or stay strictly read-only.
- Which LAN hosts, if any, need to reach consent-api directly. That decides `CONSENT_API_HOST` and whether consent-api needs internal TLS for SDK calls.
- Whether any website will ever live outside this server and LAN. That would need a public fallback hostname, which D1 does not cover.
- Whether region-level rules (US states, for example) are needed. If they are, enable Cloudflare's visitor location headers on every zone.
- Which Cloudflare plan each zone is on. On the Free plan, Bot Fight Mode cannot be skipped for a single path, so check that it does not challenge `/api/c15t/*`.
- Cloudflare's own cookies (`__cf_bm`, `cf_clearance`) need to be listed in each site's cookie policy as strictly necessary.

## Documentation

- [`docs/installation.md`](./docs/installation.md): install, upgrade, roll back and uninstall, and how to verify a release
- [`docs/nginx.md`](./docs/nginx.md): the nginx files, the Cloudflare `real_ip` file, the firewall allowlist and the nginx tests
- [`docs/database-setup.md`](./docs/database-setup.md): PostgreSQL roles, schemas, grants and the Patroni notes
- [`docs/architecture.md`](./docs/architecture.md): a map from questions to documents. [`docs/e2e.md`](./docs/e2e.md): the Playwright suite
- [`docs/security-model.md`](./docs/security-model.md) (threat model, including what is not protected), [`docs/assurance-case.md`](./docs/assurance-case.md) (why the security requirements are met, with the known gaps) and [`docs/cryptography.md`](./docs/cryptography.md) (where each cryptographic algorithm is chosen and who can change it)
- [`docs/quality-gates.md`](./docs/quality-gates.md): every gate (Biome, tsc, ESLint, knip, type coverage, FTA, code caps, coverage, scans), the Git hooks and the order they run in, and what was left out
- [`docs/security-scanning.md`](./docs/security-scanning.md) (the Semgrep and Trivy scans: what runs where, how to suppress a finding, how the tools are pinned)
- [`docs/dependency-policy.md`](./docs/dependency-policy.md) (how dependencies are chosen, updated and patched), [`docs/scorecard.md`](./docs/scorecard.md) and [`docs/openssf-best-practices.md`](./docs/openssf-best-practices.md) (the OpenSSF Scorecard and Best Practices status, with evidence)
- [`docs/licensing.md`](./docs/licensing.md): what the AGPL means if you self-host, and the third-party licenses

## Community and project health

[`CONTRIBUTING.md`](./CONTRIBUTING.md) (build, test, style, the DCO sign-off, and how to propose changes), [`SECURITY.md`](./SECURITY.md) (private vulnerability reporting and supported versions), [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md), [`GOVERNANCE.md`](./GOVERNANCE.md), [`SUPPORT.md`](./SUPPORT.md) and [`CHANGELOG.md`](./CHANGELOG.md).

## License

Copyright (C) 2026 Axiumine. This project is free software, licensed under the
[GNU Affero General Public License, version 3 or (at your option) any later version](./LICENSE)
(SPDX: `AGPL-3.0-or-later`). Every source file carries an SPDX header, and
[`REUSE.toml`](./REUSE.toml) covers the files that cannot (generated code, JSON, Markdown, ...).
Run `node scripts/add-spdx-headers.mjs --check` to verify the coverage.
What the AGPL means if you self-host, and the licenses of the dependencies, are in [`docs/licensing.md`](./docs/licensing.md).

---

## References

- c15t self-host docs: https://c15t.com/docs/self-host
- Configuration: https://c15t.com/docs/self-host/api/configuration
- HTTP endpoints: https://c15t.com/docs/self-host/api/endpoints
- Node.js SDK: https://c15t.com/docs/self-host/api/node-sdk
- Database setup: https://c15t.com/docs/self-host/guides/database-setup
- Hono RPC: https://hono.dev/docs/guides/rpc
- Better Auth with Hono: https://www.better-auth.com/docs/integrations/hono
- Yarn workspaces: https://yarnpkg.com/features/workspaces
- Cloudflare IP ranges: https://www.cloudflare.com/ips/
- nginx real_ip module: https://nginx.org/en/docs/http/ngx_http_realip_module.html
