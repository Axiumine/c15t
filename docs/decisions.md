<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Axiumine -->

# Decisions

## D1. Websites reach consent-api over a private path, and there is no public consent hostname

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
- consent-api trusts forwarded headers only from peers in `CONSENT_API_TRUSTED_PROXIES` (default loopback). It strips them from any other peer. It also checks that `Host` is in the site's `domains`, and returns 404 if it is not. `trustedOrigins` for each instance still lists the site's domains (what it does and does not do is in the [security model](./security-model.md)).
- **List every domain as a bare host name, without a port.** The nginx snippet forwards `$host`, which never carries a port, so a `shop.example.com:8443` entry can never pass the `Host` check and every request for that site gets a 404. The site form still accepts a `host:port` domain (validation allows it, and c15t would match it), but the runtime never matches it behind the shipped snippet, so a site on a non-standard port does not work.
- **When bound to a LAN address**, the path is no longer loopback (settings: [Configuration, Network](./configuration.md#network)). `@c15t/node-sdk` refuses plain `http:` with an API key for non-loopback hosts, so key-protected SDK calls must run on the consent-api host or go through TLS.
- Adding a website means adding two lines to its nginx vhost. The dashboard generates them. A website on another server (outside the LAN) would need a public fallback hostname, which is out of scope for now.

## D2. One PostgreSQL database, two schemas, two roles

- Schema `c15t` holds consent data. It is created and migrated only by `@c15t/cli self-host migrate`. Role `c15t_api` owns it and has read-write access.
- Schema `app` holds dashboard data: auth tables, `site`, `site_member` and `admin_audit`. Role `dashboard` owns it, and dashboard-api connects as that role.
- `dashboard` gets `SELECT` only on `c15t.*`. `c15t_api` gets `SELECT` only on `app.site` (the site registry).
- Why: one backup target and one engine, with the access boundaries enforced by Postgres itself.

## D3. One c15t instance per website, isolated by `tenantId`

- c15t's recommended multi-tenant pattern is one instance per tenant. Each site gets `tenantId = siteKey`, `requireTenantId: true`, and `trustedOrigins` set to the site's domains.
- All sites share the `c15t` schema, and every row is tagged with its tenant. That makes it possible to aggregate data across sites for admins, and to filter it per site for users.
- Instances are built lazily and cached. When a site row is inserted or updated, a **database trigger** on `app.site` (migration `0001_guards`) sends `NOTIFY site_changed, '<siteKey>'` as part of the same transaction. dashboard-api does not send it. consent-api `LISTEN`s on the channel and disposes the stale instance.

## D4. The dashboard reads c15t tables directly

- c15t v3 exposes no HTTP endpoints for listing consents or stats. Its admin API covers subject lookup by `externalId`, consent checks, legal-document publishing and experiment summaries.
- dashboard-api therefore queries the `c15t` schema through its read-only role. It uses Drizzle types generated by `drizzle-kit pull`, which are regenerated after every c15t upgrade.
- For the few endpoints c15t does expose (consent checks, legal-document publishing, experiment summaries), dashboard-api **will use** `@c15t/node-sdk` through `CONSENT_API_URL`. **It does not do so yet**: it reads the `c15t` schema directly today, there is no SDK dependency and no such call, so `CONSENT_API_URL` and `C15T_ADMIN_API_KEY` are optional for dashboard-api and reserved for that future use. Website servers use the SDK themselves (see [Adding a website](./adding-a-website.md)).

## D5. Admins create every credential, and there is no self sign-up

- Better Auth email + password with `disableSignUp: true`, plus the `admin` plugin for roles (`admin`, `user`), creating users, resetting passwords, bans and revoking sessions.
- An admin creates a user, and the system generates a password that is shown **once**. The user must change it on first login.
- The first admin is created from the CLI (`yarn admin:create`).

## D6. Consent records are never deleted from the dashboard

- Consent records are legal proof. When an admin disables a site, the platform stops serving it and keeps its data. Retention and purging are a separate, explicit job, still to be designed (see [Open questions](./status.md#open-questions)).

## D7. Hosting: Cloudflare, then nginx, then systemd (no Docker)

- **Cloudflare** proxies every website and the dashboard (orange cloud), with SSL mode **Full (strict)** and a Cloudflare Origin CA certificate on nginx.
- **nginx** is the only reverse proxy, and it also serves the dashboard's static files. The upstreams `c15t_consent_api` and `c15t_dashboard_api` are rendered from env by `infra/deploy.sh`. A single shared snippet, `/etc/nginx/snippets/c15t.conf`, holds the proxy settings for website vhosts, and each site's vhost adds two lines. The files are described in [`docs/nginx.md`](./nginx.md).
- **systemd** runs consent-api and dashboard-api as the `c15t` system user. Secrets live in `/etc/c15t-platform/*.env` (mode 0600), loaded through `EnvironmentFile=`. PostgreSQL is the existing Patroni cluster (D9).
- **Releases:** `infra/deploy.sh` builds into `/opt/c15t-platform/releases/<git sha>` and then switches the `current` symlink atomically.
- **Origin lock-down:** ports 80 and 443 accept traffic only from Cloudflare IP ranges (firewall), and Authenticated Origin Pulls are enabled. Without this, anyone who hits the origin IP directly could spoof `CF-Connecting-IP` or `CF-IPCountry`. A systemd timer refreshes the ranges weekly (`infra/nginx/update-cloudflare-ips.sh`, which regenerates both the nginx `real_ip` config and the firewall set). The firewall set must also be made to survive a reboot, once (see [`docs/nginx.md`](./nginx.md)).
- **Cloudflare zone rules for every site:**
  - A **Cache Rule** that bypasses the cache for paths starting with `/api/c15t/`. `/init` depends on the visitor's country, so a cached copy would apply the wrong jurisdiction's rules. consent-api also sends `Cloudflare-CDN-Cache-Control: no-store` as a backstop.
  - **WAF and bot rules must not challenge `/api/c15t/*`.** The banner calls these routes with `fetch`, so a challenge makes the call fail silently and the consent is lost.
  - **Rocket Loader** must not defer the banner script (`data-cfasync="false"`), because the banner must load before any trackers.
  - **Zaraz** consent stays off, so visitors never see two banners.
  - Enable the **"Add visitor location headers"** Managed Transform if you need region-level rules (US states, for example). It adds `cf-region-code`.

## D8. Node.js 26 LTS as the runtime, Yarn 4 as the package manager

- **Runtime: Node.js 26 LTS** for every service, CLI and test. It is pinned by `engines.node: ">=26 <27"` and `.nvmrc`. c15t (`@c15t/node-sdk` requires Node 20.19+) targets Node.
- **Yarn 4** runs through Corepack, and its version is pinned in `packageManager`. It uses Yarn workspaces (`apps/*`, `packages/*`, `workspace:*`), `nodeLinker: node-modules` (no Plug'n'Play) and `yarn install --immutable` in deploys. Scripts run across workspaces with `yarn workspaces foreach` (`-Apt` for builds, `-Api` for dev). There is no Turborepo. This is the same toolchain as the other Axiumine packages.
- **Tests:** Vitest under Node plus Playwright. **Build:** `tsc -b` for the APIs and packages, `vite build` for dashboard-web.
- Peer dependencies, `.env` loading in dev and Corepack on Node 25 and later are covered in `CLAUDE.md`, "Toolchain gotchas".

## D9. PostgreSQL runs on the existing Patroni cluster (5 nodes, etcd)

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
- **Durability:** consent records are legal proof. With asynchronous replication, a failover can lose the last committed consents. Patroni `synchronous_mode: true` prevents that, at some write-latency cost (see [Open questions](./status.md#open-questions)).
- **Connection budget:** every write lands on one primary. Add up all pools: per-site c15t instances × pool size, plus dashboard-api, listener and migrations. The total must stay well below the primary's `max_connections`. Keep each c15t instance's pool at 2–3, and revisit a shared client layer as the number of sites grows. Do not put PgBouncer in transaction mode in front of c15t, because prepared statements break.
- **Cluster config and backups:** create roles and schemas once on the primary, and they replicate to the other nodes. Manage `pg_hba` entries through Patroni's config (`postgresql.pg_hba` in the DCS), not by editing `pg_hba.conf` on a node, because Patroni overwrites that file. The cluster's existing backup tooling (pgBackRest, WAL-G, ...) must include this database. The steps are in [`docs/database-setup.md`](./database-setup.md), "Production on Patroni". Use `sslmode=verify-full` when nodes are on other hosts, and read "TLS to PostgreSQL" below.
- **TLS to PostgreSQL.** Two drivers read the URL differently, so know what each one does:
  - postgres.js (dashboard-api, the registry and `LISTEN` in consent-api, migrations) honours `sslmode`: `require` encrypts **without** verifying the certificate, `verify-full` verifies it. It ignores `sslrootcert=<file>` and sends it to Postgres as a startup parameter, which Postgres rejects. So **never put `sslrootcert` in a URL**.
  - `@effect/sql-pg` (the c15t pools in consent-api) turns `require`, `verify-ca` and `verify-full` into plain TLS with Node's default trust store, so it **verifies** the certificate even for `require`.
  - If the cluster uses a private or self-signed CA, give Node the CA file for both drivers with `NODE_EXTRA_CA_CERTS=/etc/ssl/c15t/ca.pem` in `consent-api.env` and `dashboard-api.env` (keep the file outside `/etc/c15t-platform`, which the units hide from themselves, and make it readable by user `c15t`). Without it, `sslmode=require` looks healthy on the registry and `/status` but every c15t query fails verification and consent saves return 503.

## D10. Dashboard: a React single-page app (Vite) plus a Hono API, with no SSR and no SEO

- The dashboard is private, sits behind a login and must never be indexed. Server rendering and SEO therefore bring nothing.
- **dashboard-web:** React 19 + Vite, TanStack Router + Query, react-hook-form + zod, Tailwind + shadcn/ui and Recharts. It builds to static files that nginx serves. Hashed `/assets/*` are cached for a year at Cloudflare and in the browser, and `index.html` is `no-cache`.
- **dashboard-api:** Hono on Node 26. Better Auth is mounted at `/api/auth/*`, and the JSON API lives under `/api/*`. It binds to `DASHBOARD_API_HOST:DASHBOARD_API_PORT` (default `127.0.0.1:4200`), under the same rules as consent-api.
- **Same origin:** the UI and the API are both on `dashboard.example.com`. Sessions are httpOnly cookies, there is no CORS, and Better Auth's origin check guards against CSRF.
- **Typed end to end:** dashboard-api exports `type AppType`, and the UI calls it through the Hono RPC client `hc<AppType>('/api')`. Shared zod schemas live in `@consent/shared`.
- **Authorization lives only in the API** (`authz.ts` middleware on each route group, plus a route coverage test). Route guards in the UI are only for UX.
- **Not indexed:** `X-Robots-Tag: noindex, nofollow` on every response, including the API and error pages, a `robots.txt` with `Disallow: /`, and a robots `<meta>` tag in `index.html`. There is no sitemap and there are no Open Graph tags.
- **Why not Next.js:** one server framework (Hono) serves both services. The explicit API boundary keeps authz easy to audit and test, with no server actions acting as hidden public endpoints. The UI deploys as static files, and there is less upgrade churn.

## D11. `@axiumine/koa-utils` is not used, for now

- Database access uses c15t's own driver in consent-api, and Drizzle + postgres.js in dashboard-api.
- Reasons, based on v7.1.0:
  - c15t accepts only a URL or an Effect SQL client layer, so it could never use the package's `pg` pool.
  - The pool's `error` handler calls `process.exit(-1)`. Every Patroni switchover would therefore restart the service and drop the requests in flight.
  - The pool is created at import time with `dotenv.config()` and a single host and credential set. That rules out separate primary and replica pools, and it offers no `ssl`, keepalive, timeout or lifetime options, which D9 needs.
  - The package targets Koa + GraphQL + MongoDB/Redis. The dashboard is Hono + Better Auth on Postgres.
- Revisit this when the package offers a `createPgPool(options)` factory that passes options through to `pg.Pool`, has no `process.exit` and does no env loading at import time. Even then, `pg` lacks `target_session_attrs` (D9).
