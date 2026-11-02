<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Axiumine -->

# Configuration

Development uses `.env` (from `cp env.example .env`; the repository ships the template without the leading dot). Yarn injects it into every `yarn <script>`. Production uses `/etc/c15t-platform/consent-api.env` and `dashboard-api.env` (owner `c15t`, mode 0600) and no `.env` files.

## Network

| Variable | Used by | Default | Purpose |
|---|---|---|---|
| `CONSENT_API_HOST` | consent-api, nginx upstream | `127.0.0.1` | Bind address. Must be loopback or private LAN (RFC 1918, `100.64.0.0/10`, `fc00::/7`). `0.0.0.0`, `::` and public IPs are rejected |
| `CONSENT_API_PORT` | consent-api, nginx upstream | `4100` | Bind port (1024–65535) |
| `CONSENT_API_TRUSTED_PROXIES` | consent-api | `127.0.0.1/32,::1/128` | CIDRs allowed to send `X-Forwarded-*` / `CF-*` headers. These headers are stripped from every other peer |
| `CONSENT_API_INSTANCE_POOL_MAX` | consent-api | `2` | Postgres connections per site instance (1–3). Total: sites × this |
| `CONSENT_API_REGISTRY_POOL_MAX` | consent-api | `2` | Connections for the site registry reads (1–3) |
| `CONSENT_API_DB_PREPARE` | consent-api | `true` | Set `false` only behind PgBouncer in transaction mode (prepared statements break there) |
| `CONSENT_API_URL` | website servers; dashboard-api (optional, reserved) | `http://127.0.0.1:4100` | How callers reach consent-api. Optional in dashboard-api, reserved for future SDK calls and unused today: leave it out of `dashboard-api.env` ([D4](./decisions.md#d4-the-dashboard-reads-c15t-tables-directly)) |
| `DASHBOARD_API_HOST` | dashboard-api, nginx upstream, Vite dev proxy | `127.0.0.1` | Bind address, same rules as `CONSENT_API_HOST` |
| `DASHBOARD_API_PORT` | dashboard-api, nginx upstream, Vite dev proxy | `4200` | Bind port |
| `DASHBOARD_WEB_DEV_PORT` | Vite dev server (dev only) | `5173` | Dev UI port. The dev server binds `127.0.0.1` and proxies `/api` to dashboard-api |

To serve LAN hosts, set `CONSENT_API_HOST` to the server's private IP and restrict `CONSENT_API_PORT` in the firewall to those hosts. Then add nginx's address to `CONSENT_API_TRUSTED_PROXIES` (if it is not loopback), and point `CONSENT_API_URL` at the same address. See the [D1 consequences](./decisions.md#d1-websites-reach-consent-api-over-a-private-path-and-there-is-no-public-consent-hostname) for the SDK TLS caveat.

## Secrets and services

| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_URL_C15T` | consent-api, c15t CLI | Postgres URL for role `c15t_api`, primary DNS name |
| `DATABASE_URL_DASHBOARD` | dashboard-api | Postgres URL for role `dashboard`, primary DNS name |
| `DATABASE_URL_DASHBOARD_REPLICA` | dashboard-api (optional) | Same role on the replica endpoint, used only for c15t stats, search and export ([D9](./decisions.md#d9-postgresql-runs-on-the-existing-patroni-cluster-5-nodes-etcd)) |
| `C15T_ADMIN_API_KEY` | consent-api (required, at least 16 characters), website servers; dashboard-api (optional, reserved) | Bearer key for the c15t admin endpoints. Server-side only, never sent to a browser. Optional in dashboard-api, reserved for future SDK calls and unused today: leave it out of `dashboard-api.env` ([D4](./decisions.md#d4-the-dashboard-reads-c15t-tables-directly)) |
| `BETTER_AUTH_SECRET` | dashboard-api | at least 32 characters, e.g. the output of `openssl rand -hex 32` |
| `BETTER_AUTH_URL` | dashboard-api | public dashboard origin, e.g. `https://dashboard.example.com` (dev: `http://127.0.0.1:5173`). It must equal the exact origin typed in the browser (scheme, host and port). On a mismatch the origin check answers 403, and the login form says the address is "not the dashboard's official address". Only a `BANNED_USER` 403 shows "This account is disabled" |
| `NODE_EXTRA_CA_CERTS` | consent-api, dashboard-api (optional) | Path of a CA bundle that Node trusts in addition to its own, for a PostgreSQL cluster with a private CA ([D9](./decisions.md#d9-postgresql-runs-on-the-existing-patroni-cluster-5-nodes-etcd), "TLS to PostgreSQL"). A Node setting, not read by the apps' env modules |

dashboard-web needs no runtime configuration. It calls the same-origin `/api`.
