<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Axiumine -->

# Getting started

These steps set up a development machine. To install the platform on a server, see Production below.

## Prerequisites

- Node.js 26 LTS at `/usr/bin/node` (from NodeSource, for example; `engines.node` and `.nvmrc` pin it), then `npm install -g corepack && corepack enable` for Yarn 4 (Node 26 does not bundle Corepack)
- Network access to the Patroni cluster through its internal DNS names: the primary, and optionally the replicas, plus `pg_hba` entries for roles `c15t_api` and `dashboard` added through the Patroni config
- nginx 1.25.1 or newer (`http2 on;`) with `ngx_http_realip_module` (included in the Debian and Ubuntu packages)
- Every website and the dashboard on Cloudflare (proxied), plus a firewall (nftables or ufw)

## 1. Get the source, install and configure

```bash
git clone https://github.com/Axiumine/c15t.git
cd c15t
npm install -g corepack   # Node 26 does not bundle Corepack
corepack enable
yarn install
cp env.example .env
```

## 2. Database

The full walkthrough (roles, grants, Patroni notes, a local development database) is in [`docs/database-setup.md`](./database-setup.md). In short: run [`infra/postgres/init.sql`](../infra/postgres/init.sql) once on the primary (database, roles, schemas, grants; the `psql` command is in step 1 of that document), put the two role passwords into `DATABASE_URL_C15T` (role `c15t_api`) and `DATABASE_URL_DASHBOARD` (role `dashboard`) in the file you copied in step 1, and fill in `C15T_ADMIN_API_KEY`, `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` (step 2 of that document has the exact lines). Then run the migrations and create the first admin:

```bash
yarn c15t:plan                              # review the c15t migration plan
yarn c15t:migrate                           # apply it
yarn db:migrate                             # dashboard (app schema) migrations
yarn db:pull-c15t                           # regenerate the read-only types for the c15t schema (committed; rerun after a c15t upgrade)
yarn admin:create --email you@example.com   # prints a one-time password
```

## 3. Develop

```bash
yarn dev                                    # consent-api, dashboard-api and Vite; UI at http://127.0.0.1:5173
yarn typecheck && yarn lint && yarn test    # tsc -b, biome check, vitest run
yarn lint:eslint                            # ESLint gate (run yarn typecheck first)
yarn test:e2e                               # Playwright
```

## Production

No Docker. `infra/deploy.sh install` prepares the host (the `c15t` user, directories, empty env files, systemd units), and `infra/deploy.sh` builds, migrates, switches `current`, restarts and health-checks ([D7](./decisions.md#d7-hosting-cloudflare-then-nginx-then-systemd-no-docker)). The order of the steps, upgrades, rollbacks, uninstalling and verifying a signed release are in [`docs/installation.md`](./installation.md). The nginx files, the dashboard vhost, the Cloudflare `real_ip` file, the firewall allowlist and the nginx tests are in [`docs/nginx.md`](./nginx.md).
