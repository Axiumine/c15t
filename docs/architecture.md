# Architecture

The architecture and the reasoning behind it live in the [README](../README.md). This page is a map,
so that you know where to read.

| Question | Where |
|---|---|
| What are the components and how do requests flow? | [README, Architecture](../README.md#architecture) |
| Why is consent-api private, and how do browsers reach it? | [README D1](../README.md#d1-websites-reach-consent-api-over-a-private-path-and-there-is-no-public-consent-hostname) |
| Why one database with two schemas and two roles? | README D2 |
| How is each website isolated (one c15t instance per site, `tenantId`)? | README D3 |
| Why does the dashboard read the c15t tables directly? | README D4 |
| How are credentials issued (no self sign-up)? | README D5 |
| Why are consent records never deleted from the dashboard? | README D6 |
| How is it hosted (Cloudflare, nginx, systemd, no Docker)? | README D7 |
| Which runtime and package manager? | README D8 |
| How does it cope with Patroni failovers? | README D9 |
| Dashboard structure (React SPA plus Hono API) | README D10 |
| Roles, the `app` data model, screens and API | README "Roles and permissions", "Data model", "Dashboard" |
| Configuration and environment variables | README "Configuration" and `env.example` |
| Threats and trust boundaries | [`security-model.md`](./security-model.md) |
| Rules the code must follow | [`CLAUDE.md`](../CLAUDE.md) |
| Database roles, schemas and grants | [`database-setup.md`](./database-setup.md) |

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
