# Architecture

The overview of the architecture is in the [README](../README.md), and the reasoning behind it is in
[`decisions.md`](./decisions.md). This page is a map, so that you know where to read.

| Question | Where |
|---|---|
| What are the components and how do requests flow? | [README, Architecture](../README.md#architecture) |
| Why is consent-api private, and how do browsers reach it? | [decisions.md D1](./decisions.md#d1-websites-reach-consent-api-over-a-private-path-and-there-is-no-public-consent-hostname) |
| Why one database with two schemas and two roles? | [decisions.md D2](./decisions.md#d2-one-postgresql-database-two-schemas-two-roles) |
| How is each website isolated (one c15t instance per site, `tenantId`)? | [decisions.md D3](./decisions.md#d3-one-c15t-instance-per-website-isolated-by-tenantid) |
| Why does the dashboard read the c15t tables directly? | [decisions.md D4](./decisions.md#d4-the-dashboard-reads-c15t-tables-directly) |
| How are credentials issued (no self sign-up)? | [decisions.md D5](./decisions.md#d5-admins-create-every-credential-and-there-is-no-self-sign-up) |
| Why are consent records never deleted from the dashboard? | [decisions.md D6](./decisions.md#d6-consent-records-are-never-deleted-from-the-dashboard) |
| How is it hosted (Cloudflare, nginx, systemd, no Docker)? | [decisions.md D7](./decisions.md#d7-hosting-cloudflare-then-nginx-then-systemd-no-docker) |
| Which runtime and package manager? | [decisions.md D8](./decisions.md#d8-nodejs-26-lts-as-the-runtime-yarn-4-as-the-package-manager) |
| How does it cope with Patroni failovers? | [decisions.md D9](./decisions.md#d9-postgresql-runs-on-the-existing-patroni-cluster-5-nodes-etcd) |
| Dashboard structure (React SPA plus Hono API) | [decisions.md D10](./decisions.md#d10-dashboard-a-react-single-page-app-vite-plus-a-hono-api-with-no-ssr-and-no-seo) |
| Roles, the `app` data model, screens and API | [`dashboard.md`](./dashboard.md) |
| Configuration and environment variables | [`configuration.md`](./configuration.md) and `env.example` |
| How do I set up a development machine? | [`getting-started.md`](./getting-started.md) |
| How do I add a website? | [`adding-a-website.md`](./adding-a-website.md) |
| What is done, what is still open, and which questions are unanswered? | [`status.md`](./status.md) |
| Install, upgrade, roll back and uninstall on a server | [`installation.md`](./installation.md) |
| The nginx files, the Cloudflare `real_ip` file and the firewall allowlist | [`nginx.md`](./nginx.md) |
| What the AGPL means if you self-host, and the third-party licenses | [`licensing.md`](./licensing.md) |
| Threats and trust boundaries | [`security-model.md`](./security-model.md) |
| Rules the code must follow | [`CLAUDE.md`](../CLAUDE.md) |
| Database roles, schemas and grants | [`database-setup.md`](./database-setup.md) |
| A local PostgreSQL, the test database and the variables the tests read | [`local-database.md`](./local-database.md) |
| Where does CI run, and who may run code on the runners? | [`ci-runners.md`](./ci-runners.md) |

## Repository layout

| Path | What it is |
|---|---|
| `apps/consent-api` | Hono service that runs one c15t backend instance per registered site (`/s/<siteKey>/*`). Internal only. |
| `apps/dashboard-api` | Hono JSON API with Better Auth. The security boundary of the dashboard (`src/authz.ts`). |
| `apps/dashboard-web` | React 19 and Vite single-page app, shipped as static files that nginx serves. |
| `packages/db` | Drizzle schema and migrations for the `app` schema, pool helpers with Patroni failover handling, generated read types for the `c15t` schema. |
| `packages/shared` | zod schemas, enums and the network validation shared by the API and the web app. |
| `packages/config` | Shared `tsconfig` and Biome configuration. |
| `infra` | nginx snippets and vhosts, systemd units, the PostgreSQL bootstrap script, `deploy.sh` (deploy, rollback, install, uninstall), the Cloudflare IP updater, and the test harnesses for the nginx snippets, the updater and install/uninstall (`infra/test`). |
| `scripts` | Repository tooling: SPDX headers, the CI database bootstrap, the DCO check, and the release packaging and release notes scripts (with their tests). |

## Dependency direction

`dashboard-web` imports only `@consent/shared` and types from `@consent/dashboard-api`. The two APIs
import `@consent/db` and `@consent/shared`. `@consent/shared` imports nothing from the repository. This is
checked in code review, and the TypeScript project references in the root `tsconfig.json` give the build order.
