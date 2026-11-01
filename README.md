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

## Quick start

These steps set up a development machine. They are the same as in [`docs/getting-started.md`](./docs/getting-started.md), which also lists the prerequisites.

```bash
git clone https://github.com/Axiumine/c15t.git
cd c15t
npm install -g corepack   # Node 26 does not bundle Corepack
corepack enable
yarn install
cp env.example .env
```

Create the database first (roles, schemas and grants: [`docs/database-setup.md`](./docs/database-setup.md), or [`docs/local-database.md`](./docs/local-database.md) for a local one) and fill in the database URLs and secrets in the file you just copied. Then run:

```bash
yarn c15t:plan                              # review the c15t migration plan
yarn c15t:migrate                           # apply it
yarn db:migrate                             # dashboard (app schema) migrations
yarn admin:create --email you@example.com   # prints a one-time password
yarn dev                                    # consent-api, dashboard-api and Vite; UI at http://127.0.0.1:5173
```

To install on a server, follow [`docs/installation.md`](./docs/installation.md). To connect a website, follow [`docs/adding-a-website.md`](./docs/adding-a-website.md).

## Documentation

- [`docs/decisions.md`](./docs/decisions.md): the design decisions D1 to D11 (private consent path, schemas and roles, tenants, hosting, runtime, Patroni, dashboard, `koa-utils`)
- [`docs/dashboard.md`](./docs/dashboard.md): roles and permissions, the `app` data model, the dashboard screens and the dashboard-api routes
- [`docs/configuration.md`](./docs/configuration.md): the network, secret and service environment variables
- [`docs/getting-started.md`](./docs/getting-started.md): prerequisites and the development setup
- [`docs/adding-a-website.md`](./docs/adding-a-website.md): the steps to register a website and connect its banner
- [`docs/status.md`](./docs/status.md): what is done, what is still open, and the open questions
- [`docs/installation.md`](./docs/installation.md): install, upgrade, roll back and uninstall, and how to verify a release
- [`docs/nginx.md`](./docs/nginx.md): the nginx files, the Cloudflare `real_ip` file, the firewall allowlist and the nginx tests
- [`docs/database-setup.md`](./docs/database-setup.md): PostgreSQL roles, schemas, grants and the Patroni notes
- [`docs/local-database.md`](./docs/local-database.md): a PostgreSQL for development, the tests and the e2e suite, with every environment variable
- [`docs/architecture.md`](./docs/architecture.md): a map from questions to documents. [`docs/e2e.md`](./docs/e2e.md): the Playwright suite
- [`docs/security-model.md`](./docs/security-model.md) (threat model, including what is not protected), [`docs/assurance-case.md`](./docs/assurance-case.md) (why the security requirements are met, with the known gaps) and [`docs/cryptography.md`](./docs/cryptography.md) (where each cryptographic algorithm is chosen and who can change it)
- [`docs/ci-runners.md`](./docs/ci-runners.md): where each workflow runs, what a self-hosted runner needs, why fork pull requests need approval, and the CI port rule
- [`docs/quality-gates.md`](./docs/quality-gates.md): every gate (Biome, tsc, ESLint, knip, type coverage, FTA, code caps, coverage, scans), the Git hooks and the order they run in, and what was left out
- [`docs/security-scanning.md`](./docs/security-scanning.md) (the Semgrep and Trivy scans: what runs where, how to suppress a finding, how the tools are pinned)
- [`docs/dependency-policy.md`](./docs/dependency-policy.md) (how dependencies are chosen, updated and patched), [`docs/scorecard.md`](./docs/scorecard.md) and [`docs/openssf-best-practices.md`](./docs/openssf-best-practices.md) (the OpenSSF Scorecard and Best Practices status, with evidence)
- [`docs/licensing.md`](./docs/licensing.md): what the AGPL means if you self-host, and the third-party licenses

The security notes (what is protected, what is not, and the known gaps) are in [`docs/security-model.md`](./docs/security-model.md).

## Status

Pre-1.0 (0.x). The three services, the database layer, `infra/` and the tests are implemented, and a 1.0 release is still open. What is done, what is still open and the open questions are in [`docs/status.md`](./docs/status.md).

## Community and project health

[`CONTRIBUTING.md`](./CONTRIBUTING.md) (build, test, style, the DCO sign-off, and how to propose changes), [`SECURITY.md`](./SECURITY.md) (private vulnerability reporting and supported versions), [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md), [`GOVERNANCE.md`](./GOVERNANCE.md), [`SUPPORT.md`](./SUPPORT.md) and [`CHANGELOG.md`](./CHANGELOG.md).

## License

Copyright (C) 2026 Axiumine. This project is free software, licensed under the
[GNU Affero General Public License, version 3 or (at your option) any later version](./LICENSE)
(SPDX: `AGPL-3.0-or-later`). Every source file carries an SPDX header, and
[`REUSE.toml`](./REUSE.toml) covers the files that cannot (generated code, JSON, Markdown, ...).
Run `node scripts/add-spdx-headers.mjs --check` to verify the coverage.
What the AGPL means if you self-host, and the licenses of the dependencies, are in [`docs/licensing.md`](./docs/licensing.md).

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
