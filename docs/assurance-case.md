# Assurance case

This page argues why the security requirements of the c15t consent platform are met. It has four
parts:

1. [Threat model](#1-threat-model)
2. [Trust boundaries](#2-trust-boundaries)
3. [Secure design principles](#3-secure-design-principles)
4. [Common implementation weaknesses countered](#4-common-implementation-weaknesses-countered)

[Known gaps](#known-gaps) lists the claims we could not support with code or a test.

It sits on top of two shorter pages. [`security-model.md`](./security-model.md) is the summary for
operators (assets, actors, what is and is not protected). [`cryptography.md`](./cryptography.md) lists
every cryptographic algorithm and who can change it. If this page and `security-model.md` disagree,
`security-model.md` is right and this page has a bug: please open an issue.

## The security requirements

The platform has to meet these requirements. They come from the project rules in
[`CLAUDE.md`](../CLAUDE.md) and from [`security-model.md`](./security-model.md).

| Id | Requirement |
|---|---|
| R1 | A site's consent data is readable and writable only through that site's own endpoints. One tenant never sees or changes another's data. |
| R2 | Nothing a visitor sends can choose the tenant, the recorded IP address or the jurisdiction. |
| R3 | A dashboard `user` reads only the sites an admin assigned. Only an `admin` changes platform data. A user can change only their own password. |
| R4 | Every dashboard API route requires a valid session, and the access rule is checked on every request. |
| R5 | Credentials are issued by admins, never stored in plain text, and are rate limited, revocable and auditable. |
| R6 | Every admin change is recorded in an audit log, in the same transaction as the change. The application cannot update or delete log rows (database triggers). The role the application logs in with owns those triggers, so this does not hold against a compromised dashboard-api or a database administrator (4.4). |
| R7 | Secrets stay on the server. Browsers, logs, error messages and the repository never contain them. |
| R8 | A failure (database failover, bad configuration, unknown site) ends in a refusal, not in wrong or cross-tenant data. |
| R9 | The code, its dependencies and its releases are traceable and tamper-evident. |

## How to read the evidence

Each claim names **code** (a file and function, as a link) and a **test** (a file and a test name).
Line numbers are left out on purpose, because they go stale.

- A test without a tag runs in the CI job `Test (PostgreSQL 17, coverage)` of
  [`ci.yml`](../.github/workflows/ci.yml) (`yarn test`, against a real PostgreSQL server).
- A test tagged **[manual]** is run by a maintainer. At the time of writing, CI does not run the
  Playwright suite in [`e2e/`](../e2e) (`yarn test:e2e`, see [`e2e.md`](./e2e.md)) or
  [`infra/test/nginx-snippet.test.sh`](../infra/test/nginx-snippet.test.sh), which needs Docker.
  CI does run two other infra scripts, in the step `Test the infra scripts` of the `verify` job:
  [`infra/test/uninstall.test.sh`](../infra/test/uninstall.test.sh) and
  [`infra/test/update-cloudflare-ips.test.sh`](../infra/test/update-cloudflare-ips.test.sh). The second one
  is cited in 4.3.
- Where there is no test, or the test is weaker than the claim, the text says so. All of these are
  collected in [Known gaps](#known-gaps).

---

## 1. Threat model

### 1.1 Scope

In scope: consent-api, dashboard-api, dashboard-web, the `c15t` and `app` database schemas and their
roles, the nginx and systemd files in [`infra/`](../infra), and the build and release pipeline. The
platform runs on one operator-controlled server behind Cloudflare, with a PostgreSQL cluster (README D7,
D9). It was written against release 0.1.0. When the code changes, the questions at the end of
`security-model.md` ("Reviewing a change for security") apply.

### 1.2 Assets

| Id | Asset | Property that matters | Kept in |
|---|---|---|---|
| A1 | Consent records | Integrity, confidentiality per site. They are legal proof. | `c15t` schema |
| A2 | Personal data inside them: masked IP address, user agent, country, region, subject and external IDs | Confidentiality per site | `c15t` schema |
| A3 | Dashboard credentials and sessions | Confidentiality, integrity | `app.account`, `app.session` |
| A4 | Admin audit log | Integrity (append-only for the application, see 3.6 and 4.4) | `app.admin_audit` |
| A5 | Site registry: key, domains, policy preset, status | Integrity. It decides which tenant a request reaches. | `app.site` |
| A6 | Secrets: `C15T_ADMIN_API_KEY`, `BETTER_AUTH_SECRET`, database URLs | Confidentiality | `/etc/c15t-platform/*.env` (mode 0600) |
| A7 | The jurisdiction decision (visitor IP and country) | Integrity of its inputs | request headers |
| A8 | Source code and release files | Integrity, authenticity | GitHub, release assets |
| A9 | Availability of the consent endpoints | A broken banner loses consents | consent-api, nginx |

### 1.3 Actors and attackers

| Id | Actor | What they can do | What they want |
|---|---|---|---|
| X1 | Anonymous visitor, or a script posing as one | Send any HTTP request, with any headers, to the public consent endpoints of every site vhost they can reach | Fake or alter consents, pick a jurisdiction, read another tenant's data |
| X2 | Dashboard `user` | Hold a valid session with read-only access to assigned sites | Read other sites, become admin, change data |
| X3 | Network attacker | Observe or modify traffic on a hop that has no TLS, or has weak TLS | Steal sessions, secrets, records |
| X4 | Anyone who can reach the origin without Cloudflare | Send requests straight to nginx. nginx ignores their `CF-Connecting-IP`, but passes `CF-IPCountry` and `cf-region-code` through unchanged. | Pick their own jurisdiction. The recorded IP is their real TCP address. |
| X5 | Website server code | Call consent-api directly with the API key | Misuse the key (partly trusted) |
| X6 | Supply-chain attacker | Publish a malicious dependency, compromise an action, tamper with a release | Run code in the build or on the server |
| X7 | Operator error | Misconfigure the firewall, Cloudflare, env files | (not an attacker; a source of threats the defaults must survive) |
| X8 | Admin | Hold full dashboard rights. Trusted, and audited. | (out of scope for prevention) |

### 1.4 Entry points

| Id | Entry point | Reached by | Authentication |
|---|---|---|---|
| E1 | `/api/c15t/*` on each website vhost, rewritten by nginx to consent-api `/s/<siteKey>/*` | X1, X4 | None for the public routes. A bearer key for the key-protected c15t routes. |
| E2 | consent-api `/health`, `/status` | Internal only. The nginx rewrite always prefixes `/s/<siteKey>/`, so these root paths are not reachable through the snippet. | None |
| E3 | dashboard-web static files | Anyone | None (no secrets in the bundle) |
| E4 | `/api/auth/*`: four endpoints (sign-in, sign-out, get-session, change-password) | Anyone | Sign-in is anonymous. The other three act on the caller's session. |
| E5 | `/api/health` | Anyone | None |
| E6 | `/api/me`, `/api/sites/**`, `/api/admin/**` | X2, X8 | Session, then role or site access |
| E7 | Shell commands `yarn admin:create`, `yarn db:migrate`, `yarn c15t:migrate` | Operator on the host | Shell access and database credentials |
| E8 | consent-api on `CONSENT_API_URL` | X5, anything that can reach the port | API key for key-protected routes only |
| E9 | PostgreSQL connections from both services | Services only | Role passwords |
| E10 | Environment files and systemd units | Host users | File permissions |
| E11 | Pull requests, dependencies, GitHub Actions, release workflow | X6 | GitHub permissions, review |

### 1.5 Threats

| Id | Threat | Actor, entry | Asset | Countered in |
|---|---|---|---|---|
| T1 | Read or write another site's data by confusing the tenant | X1, E1 | A1, A2 | 3.1, 3.3, 3.7, 4.2 (CWE-639) |
| T2 | Choose your own jurisdiction or IP with forged headers or query parameters | X1, E1 | A7 | 3.10, 4.2 (CWE-20) |
| T3 | Forge `CF-IPCountry` or `cf-region-code` by talking to the origin directly (the IP header is ignored from non-Cloudflare peers) | X4, E1 | A7 | Operator control, see 2 and 4.4 |
| T4 | Escape `/s/<siteKey>/` with `..` or encoded slashes | X1, E1 | A1 | 3.10, 4.2 (CWE-22) |
| T5 | Submit fake consents, or flood the endpoints | X1, E1 | A1, A9 | **Not countered**, see 4.4 |
| T6 | A user reads another site or acts as admin | X2, E6 | A1, A3 | 3.2, 3.3, 3.5, 3.6, 4.2 (CWE-862, 863, 639) |
| T7 | Call a dashboard route without a session | anyone, E6 | A1 to A5 | 3.3, 4.2 (CWE-306) |
| T8 | Guess or stuff passwords | anyone, E4 | A3 | 4.2 (CWE-307, 521), 4.4 |
| T9 | Cross-site request forgery against admin actions | X2, X8 victims, E6 | A3, A5 | 4.2 (CWE-352) |
| T10 | Script or formula injection through visitor-controlled text shown in the dashboard or exported | X1, E3, E6 | A3 | 4.2 (CWE-79, CWE-1236) |
| T11 | SQL injection through filters, cursors, paths | X2, E6 | A1 to A5 | 4.2 (CWE-89, CWE-20) |
| T12 | Reuse a stale session, or a leaked one-time password | X2 | A3 | 3.3, 4.2 (CWE-613) |
| T13 | Remove the last admin, or race two admin changes | X8 | A3 | 4.2 (CWE-362, CWE-269) |
| T14 | Alter the audit log | database insider | A4 | 3.6, 4.4 |
| T15 | Secrets leak through logs, errors, the bundle or the repository | any | A6 | 4.2 (CWE-200, 532, 798) |
| T16 | A failover sends writes or reads to a demoted node | infrastructure | A1, A9 | 3.2, 4.2 (CWE-362) |
| T17 | Malicious dependency, action or release | X6, E11 | A8 | 4.1 (A06, A08) |
| T18 | Eavesdrop or tamper on a hop without TLS | X3 | A1, A3, A6 | [`cryptography.md`](./cryptography.md), 4.4 |
| T19 | Denial of service by volume, large bodies or slow requests | X1, E1, E6 | A9 | 4.2 (CWE-400), 4.4 |
| T20 | A compromised service reads the other service's secrets | any | A6 | **Partly countered**: 3.7 and 4.4. Both services run as the same user. |

### 1.6 Out of scope

These are not defended against, and the platform does not claim to:

- A compromised host, a root user, or a malicious database administrator. There is no tamper evidence
  on consent records (`security-model.md`).
- A compromised Cloudflare account or edge.
- Proving that a consent record came from a real visitor (T5).
- Volume denial of service. The operator uses Cloudflare rate limits and the firewall.
- The website's own pages. The banner script runs inside them, under the website's own CSP.
- Vulnerabilities in the operator's deployment: open ports, weak passwords the operator chose, a wrong
  Cloudflare zone.
- Legal compliance (GDPR and others). The software records consent. It does not make a site compliant.
- Social engineering, physical access, and attacks on an admin's own browser or machine.
- Flaws in third-party code (c15t, Better Auth, Hono, ...) that we have not found. See the
  [dependency policy](./dependency-policy.md) for how fast we react once one is known.

---

## 2. Trust boundaries

The full table of actors is in [`security-model.md`](./security-model.md#actors-and-trust-boundaries). The
data flow is:

```
Visitor browser --(HTTPS)--> Cloudflare --> nginx (per-site vhost) --> consent-api --> PostgreSQL (role c15t_api)
Admin / user browser --(HTTPS)--> Cloudflare --> nginx --> dashboard-api --> PostgreSQL (role dashboard)
Website server code ----------------------------------------> consent-api (CONSENT_API_URL, API key)
```

### 2.1 The boundaries

| Id | Boundary | Untrusted side | Trusted side | What enforces it |
|---|---|---|---|---|
| B1 | Internet to nginx | Everyone | nginx and Cloudflare, for the headers they set | Firewall allowlist and Authenticated Origin Pulls (operator, README D7). `real_ip` trusts only Cloudflare ranges ([`update-cloudflare-ips.sh`](../infra/nginx/update-cloudflare-ips.sh)). |
| B2 | nginx to consent-api | The request, including all its headers | The tenant mapping (`set $c15t_site`) and `CF-*` headers, from configured proxies only | [`c15t.conf`](../infra/nginx/c15t.conf) replaces `X-Forwarded-*`. [`request-guard.ts`](../apps/consent-api/src/request-guard.ts) strips what a non-proxy peer sends. |
| B3 | nginx to dashboard-api | The request | `X-Forwarded-For` set by nginx | [`dashboard-locations.conf`](../infra/nginx/dashboard-locations.conf), then [`authz.ts`](../apps/dashboard-api/src/authz.ts) |
| B4 | Anything that can reach the consent-api port | The caller | The tenant, taken from the path | The bind address (loopback or private only) and the firewall. A direct caller by IP or `localhost` skips the `Host` check, so any caller that reaches the port can address any active `siteKey`. |
| B5 | Browser code (dashboard-web) to dashboard-api | All of dashboard-web, including its route guards | dashboard-api | [`authz.ts`](../apps/dashboard-api/src/authz.ts) re-checks everything. Guards in the web app are convenience only. |
| B6 | Services to PostgreSQL | The services (they could have a bug) | The database grants | Two roles, `c15t_api` and `dashboard`, with separate grants ([`init.sql`](../infra/postgres/init.sql), [`0001_guards.sql`](../packages/db/drizzle/0001_guards.sql)) |
| B7 | consent-api to dashboard-api, and each to the other's secrets | Each other | Itself | Separate processes and separate env files. `InaccessiblePaths=/etc/c15t-platform` hides the env files from both. Both units run as the same user `c15t`, and the values are still in `/proc/<pid>/environ`, which the same user can normally read (`ProtectProc=invisible` hides only other users' processes). So this boundary is weak against code execution in either service. No host test of this (4.4). See the [systemd units](../infra/systemd). |
| B8 | Third-party code inside the process (c15t, Better Auth, Hono, Drizzle) | Its unknown bugs | Trusted to do its documented job | Not isolated. Pinned versions, [dependency policy](./dependency-policy.md), tests that exercise it. |
| B9 | Contributors and build inputs to the released artifact | Pull requests, dependencies | `main` plus a tagged, signed release | Review, CI, pinned actions, signed release ([`release.yml`](../.github/workflows/release.yml)) |

### 2.2 Rules that follow

1. **Nothing the visitor sends is trusted** for tenant, IP, country or GPC. The tenant is the `siteKey` in
   the path, set by nginx. The IP and country come from headers that only a trusted proxy may provide.
2. **Trust in forwarded headers depends on the TCP peer**, not on the header. The peer must be listed in
   `CONSENT_API_TRUSTED_PROXIES`.
3. **dashboard-api is the only access control point** for the dashboard (B5).
4. **The database is a second wall** (B6). Through the application, a bug in dashboard-api cannot write
   consent data, and a bug in consent-api cannot read the credentials. This is a database-role limit. It does
   not hold if an attacker runs code in one service and reads the other's secrets (B7), because then the
   attacker can log in with the other role.
5. **Third-party code is trusted but not isolated** (B8). The mitigation is process, not sandboxing.

This agrees with `security-model.md`: nginx and Cloudflare are trusted for the headers they set,
consent-api trusts forwarded headers only from configured proxies, and "anyone who can reach the origin
directly" is untrusted. The origin lock-down (B1) is the operator's job. It is the single biggest
assumption of the whole model.

---

## 3. Secure design principles

Each principle has a short argument, the code, the test that proves it, and its limit.

### 3.1 Economy of mechanism

**Argument.** The security decisions are few and sit in few places. The project writes no cryptography
and no session logic. Access checks are three middlewares in one file. Tenant resolution is one
function. Each app reads its environment in one module. Better Auth's HTTP surface is cut from dozens
of endpoints to four.

**Code.** [`authz.ts`](../apps/dashboard-api/src/authz.ts) (`requireSession`, `requireAdmin`,
`requireSiteAccess`). `SiteRegistry.use` in [`registry.ts`](../apps/consent-api/src/registry.ts).
`AUTH_ENDPOINTS` in [`app.ts`](../apps/dashboard-api/src/app.ts). `env.ts` in each app. No custom
cryptography: [`cryptography.md`](./cryptography.md).

**Test.** `route-coverage.test.ts` (dashboard-api): `the route tree is exactly the documented API` and
`keeps the Better Auth endpoint closed` (eight endpoints and two path variants, including sign-up and the admin plugin).
`authz.test.ts`: `the Better Auth admin endpoints are not a way around the API`.

**Limit.** The stack is large (Hono, Better Auth, c15t, Drizzle, React). Economy applies to our code, not
to the dependencies.

### 3.2 Fail-safe defaults

**Argument.** When something is missing, unknown or broken, the answer is refusal. An unknown or disabled
site is a 404. A peer with no connection info is untrusted. An empty tenant scope returns no rows. An
unknown role gets no access. A bind address that is public or a wildcard is rejected at start-up.
c15t is told to refuse a missing tenant.

**Code.**
- Unknown or disabled site: `settle` and `acquire` in [`registry.ts`](../apps/consent-api/src/registry.ts).
- Untrusted by default: `peerAddress` in [`app.ts`](../apps/consent-api/src/app.ts) and `sanitizeHeaders` in
  [`request-guard.ts`](../apps/consent-api/src/request-guard.ts).
- `requireTenantId: true`, `assertTrustedOrigins` (non-empty, no wildcard) in
  [`instance.ts`](../apps/consent-api/src/instance.ts).
- Empty scope: `inScope` in [`c15t-read.ts`](../apps/dashboard-api/src/c15t-read.ts).
- Unknown role: `readSession` in [`authz.ts`](../apps/dashboard-api/src/authz.ts) ("Fail closed").
- Bind address: `hostSchema` in [`network.ts`](../packages/shared/src/network.ts).
- No sign-up: `disableSignUp` in [`auth.ts`](../apps/dashboard-api/src/auth.ts).
- Database failure: a 503 with `Retry-After`, never wrong data (`serveSite` in `app.ts`).

**Test.** `registry.test.ts`: `a disabled site is not found and gets no instance`.
`app.test.ts` (consent-api): `a request with no connection info is treated as untrusted`.
`instance.test.ts`: `c15t itself rejects a missing tenant: requireTenantId is on` and the
`assertTrustedOrigins` rejections (empty list, `*`, `*.example.com`). `c15t-read.test.ts`:
`an empty scope or an unknown tenant returns nothing`. `env.test.ts` (consent-api and dashboard-api):
`rejects the bind address %s`. `auth.test.ts`: `sign-up is disabled and passwords have the platform length limits`.
`app.test.ts`: `a read that hits a database error is retried once on a fresh instance` and
`a write is never retried, but the instance is replaced for the next request`.

**Limit.** The `Host` check is not fail-safe in three cases: no `Host` header at all, an IP literal,
or `localhost` all pass (see B4 and `requestHostAllowed`; the test `direct calls by IP or localhost have no site host to verify`
documents it). The unknown-role refusal has no test (see Known gaps).

### 3.3 Complete mediation

**Argument.** Every request is checked every time, against the current database state. dashboard-api
does not cache sessions in the cookie, and `requireSiteAccess` reads the user's memberships from the
primary on each request. Every route group attaches its guard explicitly. In consent-api every request
under `/s/` passes the path check, the header sanitizer and the `Host` check before it reaches c15t.

**Code.** `cookieCache: { enabled: false }` in [`auth.ts`](../apps/dashboard-api/src/auth.ts).
`accessibleSites(db.primary, user)` inside `requireSiteAccess`. `.use('*', authz.requireSiteAccess)` in
[`routes/sites.ts`](../apps/dashboard-api/src/routes/sites.ts), `requireAdmin` in the admin route files.
`createApp` in [`apps/consent-api/src/app.ts`](../apps/consent-api/src/app.ts) (path middleware, then
`serveSite`).

**Test.** `route-coverage.test.ts`: `every route outside the allowlist answers 401 without a session`
(it walks `app.routes`, and the database stub throws if a query runs before a guard) and
`a bogus session cookie is also a 401, on every guarded route`. `authz.test.ts`:
`removing a membership takes effect on the next request, with the same session`,
`demoting an admin takes effect on the next request`, `a revoked session is rejected at once`,
`a ban that left a session behind still blocks every request`.

**Limit.** consent-api caches the site registry. A change reaches a running instance through the
`NOTIFY site_changed` trigger. If a notification is lost, the cached copy is trusted for up to
5 minutes (`DEFAULT_TTL_MS` in `registry.ts`). The test `stops serving a site that was disabled while the notification was missed`
shows the backstop. On a listener reconnect all instances are dropped (`onResync` in `server.ts`).

### 3.4 Open design

**Argument.** The design does not depend on secrecy. The source is public under AGPL-3.0-or-later. The
algorithms are public and standard (scrypt, HMAC-SHA-256, TLS). The only secrets are keys and passwords,
held in 0600 environment files. The model, its gaps and its crypto are written down in this folder.

**Code and evidence.** [`LICENSE`](../LICENSE), this page, [`security-model.md`](./security-model.md),
[`cryptography.md`](./cryptography.md), [`SECURITY.md`](../SECURITY.md).

**Test.** No test applies. The nearest automated check is `yarn spdx:check` in `ci.yml`, which covers licence
headers, not design.

**Limit.** Publishing the design also publishes its weaknesses, which is why the gaps are listed here.

### 3.5 Separation of privilege

**Argument.** Sensitive actions need more than one independent condition. An admin action needs a valid
session, the `admin` role and a same-origin request. The c15t API key is separate from dashboard
sessions, and dashboard-api does not need it. The database has two roles. A new user cannot do anything
except change their password until they have replaced the generated one. Some admin actions are refused
outright: banning or resetting yourself, and demoting or banning the last active admin. The release
workflow splits build, signing and publishing into jobs with different permissions.

**Code.** `requireAdmin`, `loadUser` (the `mustChangePassword` check) in [`authz.ts`](../apps/dashboard-api/src/authz.ts).
The Origin check in [`app.ts`](../apps/dashboard-api/src/app.ts). `ensureNotLastAdmin` and the self checks in
[`routes/admin-users.ts`](../apps/dashboard-api/src/routes/admin-users.ts). `C15T_ADMIN_API_KEY` optional in
[`env.ts`](../apps/dashboard-api/src/env.ts). Job permissions in [`release.yml`](../.github/workflows/release.yml)
(`build` has read-only contents, `sign` adds `id-token: write`, `release` has `contents: write`).

**Test.** `authz.test.ts`: `a user gets 403 on every admin route and nothing changes`,
`mustChangePassword limits a user to /api/me, change-password and sign-out`. `admin.test.ts`:
`an admin cannot reset or ban their own account through the admin API`,
`the only active administrator cannot demote themselves; with two they can`. `env.test.ts` (dashboard-api):
`starts without C15T_ADMIN_API_KEY and CONSENT_API_URL, which nothing in dashboard-api uses yet`.

**Limit.** There is one `admin` role that can do everything, and no second approver. There is no
multi-factor authentication.

### 3.6 Least privilege

**Argument.** Each component gets only what it needs. `c15t_api` owns the `c15t` schema and can only
`SELECT` from `app.site`. `dashboard` owns `app` and can only `SELECT` from `c15t.*`. Neither can create
roles, databases or schemas. Dashboard `user`s are read-only and see only assigned, active sites. The
audit table refuses `UPDATE`, `DELETE` and `TRUNCATE` through database triggers (see the limit below for
who owns them). Both services run as the unprivileged `c15t` user with no capabilities and a read-only file
system (apart from a private `/tmp`).

**Code.** [`infra/postgres/init.sql`](../infra/postgres/init.sql), [`0001_guards.sql`](../packages/db/drizzle/0001_guards.sql)
(`admin_audit_append_only`, `admin_audit_no_truncate`, the `c15t_api` grant). `TenantScope` in
[`authz.ts`](../apps/dashboard-api/src/authz.ts). `NoNewPrivileges`, `CapabilityBoundingSet=` (empty),
`ProtectSystem=strict` in [`c15t-consent-api.service`](../infra/systemd/c15t-consent-api.service) and
[`c15t-dashboard-api.service`](../infra/systemd/c15t-dashboard-api.service).

**Test.** `migrations.test.ts` (db): `c15t_api can read the site registry and nothing else in app` and
`is append-only: update, delete and truncate are refused`. `integration.test.ts` (consent-api):
`c15t_api can read the registry but nothing else in the app schema` (real PostgreSQL, SQLSTATE `42501`).
[`scripts/ci-bootstrap-db.sh`](../scripts/ci-bootstrap-db.sh) asserts in CI that `dashboard` has `SELECT` and no
`INSERT` on a c15t table, that neither role can create roles or databases, and that `c15t_api` cannot read `app."user"`.
`authz.test.ts`: `a user gets 403 on every admin route and nothing changes`.

**Limit.** The audit triggers are owned by the `dashboard` role, because that role owns the `app` schema and
runs the migrations. It is the same role dashboard-api logs in with, so code running as dashboard-api could
drop or disable the triggers, and so can a database administrator. The triggers stop the application's
normal statements, not a compromised dashboard-api. The `dashboard` write refusal is checked on one c15t
table by the CI script. No application test attempts a write with the `dashboard` role. The systemd sandbox
has no automated test (the unit comments point at `systemd-analyze security`, run by hand).

### 3.7 Least common mechanism

**Argument.** Components share as little as possible. consent-api and dashboard-api are separate processes
with separate environment files, and `InaccessiblePaths` hides `/etc/c15t-platform` from both. Each site gets its own c15t instance and its
own connection pool. The dashboard reads analytics from a separate pool (`db.analytics`) from the one that
does authorization and writes (`db.primary`). Joins on c15t tables always include the tenant.

**Code.** `createSiteInstance` and `createDatabaseLayer` in [`instance.ts`](../apps/consent-api/src/instance.ts).
`InaccessiblePaths=/etc/c15t-platform` in the units. [`db.ts`](../apps/dashboard-api/src/db.ts) and
`fetchRows` in [`c15t-read.ts`](../apps/dashboard-api/src/c15t-read.ts) (every join has
`eq(x.tenantId, consent.tenantId)`).

**Test.** `integration.test.ts` (consent-api): `site A's reader gets the record, site B's does not` and
`site B cannot take over site A's subject id, and writes nothing`. `c15t-read.test.ts`:
`never exposes a subject that belongs to another tenant`. `streaming.test.ts`: `c15t reads use the analytics pool`.

**Limit.** Both services run as the same system user `c15t`. The unit files set `ProtectProc=invisible`, which
hides only other users' processes, and set no `PrivateUsers` or `PrivatePIDs`. The environment of a process
is readable by the same user through `/proc/<pid>/environ`. So code running inside one service can probably read the
other's secrets (the `dashboard` or `c15t_api` database password, `BETTER_AUTH_SECRET`, `C15T_ADMIN_API_KEY`),
even though the env files are not readable. This was reasoned from the unit files and not tested on a host.
One system user per service would close it (Known gaps). All sites share one database role and the same `c15t` tables. Separation between tenants is
the `tenantId` column, applied by c15t (writes) and by our queries (reads), not by separate databases or
schemas. A flaw in c15t's tenant filter would cross tenants. `requireTenantId`, the `Host` check and the
tests above reduce that risk. They do not remove it.

### 3.8 Psychological acceptability

**Argument.** The secure way is the easy way. Admins never choose a password: the server generates one,
shows it once, and forces a change at first login. The generated alphabet has no look-alike characters.
The Setup screen gives the exact two nginx lines that map a site to its tenant, so operators copy that
security-critical configuration instead of writing it. Errors share one JSON shape and one safe message per
code. Sign-in failures show one generic message.

**Code.** [`password.ts`](../apps/dashboard-api/src/password.ts), `siteSetup` in
[`site-mapping.ts`](../apps/dashboard-api/src/site-mapping.ts),
[`one-time-password-dialog.tsx`](../apps/dashboard-web/src/components/one-time-password-dialog.tsx),
`SAFE_MESSAGES` in [`errors.ts`](../apps/dashboard-api/src/errors.ts).

**Test.** `password.test.ts`: `meets the platform password rules and avoids look-alike characters`.
`site-mapping.test.ts`: `the nginx snippet is exactly the two lines of the README`.
`one-time-password.test.tsx`: `the one-time password is shown once, survives Escape, and is gone after closing`.
`login.test.tsx`: `wrong credentials show one generic message and keep the form` and
`first login with a temporary password forces a change, then opens the app`. `errors.test.ts`:
`Better Auth errors map to a status but never forward their text`. The a11y suite
[`e2e/a11y.spec.ts`](../e2e/a11y.spec.ts) **[manual]** checks nine screens.

**Limit.** Operators still configure the firewall, Cloudflare and nginx by hand. A wrong step there is
not caught by the software (B1).

### 3.9 Limited attack surface

**Argument.** There is little to attack. consent-api has no public hostname and binds only to a loopback
or private address. nginx exposes one path prefix, and the rewrite puts the tenant in front of it. The
dashboard has a fixed route tree, four auth endpoints and no CORS. The application code has no file
upload, no outbound HTTP request, no process spawn and no deserialization of untrusted objects (c15t has
dormant outbound paths, see CWE-918 in 4.2). c15t's OpenAPI
document is turned off, and Better Auth telemetry is off. Bodies are size-limited. Dot files are a 404.

**Code.** `hostSchema` and `serve({ hostname })` ([`env.ts`](../apps/consent-api/src/env.ts),
[`server.ts`](../apps/consent-api/src/server.ts)). [`c15t.conf`](../infra/nginx/c15t.conf) (`location ^~ /api/c15t/`, rewrite to `/s/$c15t_site/`).
`openapi: { enabled: false }` in `instance.ts`. `telemetry: { enabled: false }` in `auth.ts`.
`MAX_BODY_BYTES` in both `app.ts` files. `location ~ /\.` in
[`dashboard-locations.conf`](../infra/nginx/dashboard-locations.conf).

**Test.** `route-coverage.test.ts`: `the route tree is exactly the documented API`.
`instance.test.ts`: `does not publish an OpenAPI document`. `app.test.ts` (consent-api): `refuses an oversized body`
and `an unsupported method is a JSON 404`. `route-coverage.test.ts`: `refuses an oversized body`.
[`infra/test/nginx-snippet.test.sh`](../infra/test/nginx-snippet.test.sh) **[manual]**: `the /s/ prefix is not reachable from outside`,
`dashboard: dotfiles are 404`.

**Limit.** The public consent endpoints are, by design, open to anyone who reaches a site vhost (T5).

### 3.10 Input validation with allowlists

**Argument.** Every boundary validates with a schema that says what is allowed, not what is forbidden.
Site keys match `^[a-z0-9-]{3,40}$`. Domains must be host names (`host` or `host:port`), with no scheme,
path or wildcard. Request bodies are strict objects, so unknown fields are rejected and a caller cannot
set `key`, `password` or `mustChangePassword`. Roles, statuses and presets are enums. Cursors are decoded
and re-validated. Country and region codes from Cloudflare must match a code pattern. The database
repeats the key and domain rules as `CHECK` constraints.

**Code.** `SITE_KEY_PATTERN`, `domainSchema`, `domainsSchema`, `siteCreateSchema`, `siteUpdateSchema` in
[`site.ts`](../packages/shared/src/site.ts). [`user.ts`](../packages/shared/src/user.ts) (`z.strictObject`).
[`validate.ts`](../apps/dashboard-api/src/validate.ts) (`@hono/zod-validator`). `decodeCursor` in
[`pagination.ts`](../apps/dashboard-api/src/pagination.ts). `COUNTRY_CODE`, `REGION_CODE`, `siteKeyFromPath`
in [`request-guard.ts`](../apps/consent-api/src/request-guard.ts). `site_key_format_check`,
`site_domains_check` in [`schema.ts`](../packages/db/src/schema.ts). `noNul` in [`text.ts`](../packages/shared/src/text.ts).

**Test.** `site.fuzz.test.ts` (shared): `the site key schema never throws and accepts exactly 3 to 40 of a-z, 0-9 and hyphen`,
`an accepted domain has no wildcard, scheme, path, credentials or white space`. `user.test.ts`:
`never accepts a password from the caller`. `admin.test.ts`: `the site key cannot be changed, and unknown sites are 404`.
`request-guard.test.ts`: `drops malformed codes instead of passing them to c15t`. `migrations.test.ts`:
`rejects empty or wildcard domains`, `rejects a malformed key`. `hostile-input.test.ts`: forged cursors,
NUL bytes and impossible dates are a 400, never a 500.

**Limit.** Two checks are deny-lists. `isSafePath` rejects `..`, encoded dots, slashes and control
characters (the site key behind it is an allowlist). `sanitizeHeaders` removes named override and
forwarding headers. Their lists are taken from the installed c15t, and the test
`every country and region header the installed c15t reads is stripped or Cloudflare-only` fails when an
upgrade adds one.

---

## 4. Common implementation weaknesses countered

### 4.1 OWASP Top 10 (2021)

Verdicts: **Countered**, **Partly** (countered, with a stated residual risk), **Not applicable**.

| Category | Verdict | How, and what is left |
|---|---|---|
| A01 Broken Access Control | Partly | Guards in `authz.ts`, route coverage test, `TenantScope`, 404 for inaccessible sites, tenant only from the path (3.3, 3.6, CWE-862, 863, 639). Left: consent saves are unauthenticated by design, and c15t's `GET /subjects/:id` and `PATCH /subjects/:id` need no API key, so a subject ID works as a bearer secret (4.4). |
| A02 Cryptographic Failures | Partly | No custom cryptography; scrypt, HMAC-SHA-256 and TLS 1.2 and 1.3 ([`cryptography.md`](./cryptography.md)). Left: no application-level encryption of records, no TLS from nginx to the services, Cloudflare and PostgreSQL TLS are operator settings. |
| A03 Injection | Countered | Bound SQL parameters, no process spawn, React escaping plus CSP, CSV formula neutralising, NUL and date validation (CWE-89, 79, 78, 94, 1236). |
| A04 Insecure Design | Partly | This page: threat model, boundaries, principles. Tenant isolation by construction, last-admin rule, forced password change. Left: no MFA, no tamper evidence, the T5 gap (fake consents), the T3 gap (a direct caller picks the jurisdiction) and the subject routes in 4.4. |
| A05 Security Misconfiguration | Partly | Secure defaults in code: bind validation, security headers on every dashboard response, OpenAPI and telemetry off, `server_tokens off`, systemd hardening. Left: the firewall, Authenticated Origin Pulls and Cloudflare rules are the operator's and no software checks them. |
| A06 Vulnerable and Outdated Components | Partly | Exact pins, committed `yarn.lock`, `--immutable` installs, Dependabot with cooldown, `dependency-review`, CodeQL, Scorecard, written response times ([`dependency-policy.md`](./dependency-policy.md)). Left: `yarn npm audit` before a release is a manual step, not a CI job, and a flaw in a dependency stays until patched. |
| A07 Identification and Authentication Failures | Partly | No sign-up, no default account (the first admin gets a random one-time password), 12 to 128 character passwords, forced change, rate limit, bans, session revocation (CWE-287, 307, 521, 613). Left: no MFA, and the rate limit is per client IP and path, not per account. |
| A08 Software and Data Integrity Failures | Partly | Actions pinned by commit SHA (one documented exception), signed releases with provenance and SBOM, no unsafe deserialization (CWE-502). Left: `infra/deploy.sh` does not verify release signatures, and consent records have no integrity protection. |
| A09 Security Logging and Monitoring Failures | Partly | `app.admin_audit` written in the same transaction as the change, with triggers that refuse update, delete and truncate (owned by the role dashboard-api uses, so not a defence against a compromised dashboard-api or a database administrator). JSON logs with no secrets (CWE-532). Left: failed sign-ins and read access (including CSV exports) are not written to the audit table, and alerting is the operator's job (README). |
| A10 Server-Side Request Forgery | Not applicable for our code | The application code makes no outbound HTTP request. c15t has outbound paths that are not reachable with the current presets (CWE-918 in 4.2). A caller cannot choose a URL. |

### 4.2 CWE Top 25 and related weaknesses

The CWE numbers below are from the 2024 CWE Top 25 where they appear there, plus a few related ones
that matter for this stack (CWE-639, 1236, 601, 613, 307, 521, 532, 1021). Memory-safety entries are
covered in the last row.

| CWE | Verdict | Counter (code) | Test |
|---|---|---|---|
| CWE-79 Cross-site scripting | Partly | No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `document.write` in non-test source (searched). React escapes text. CSP `default-src 'self'` with no `script-src`, so only same-origin scripts run ([`dashboard-headers.conf`](../infra/nginx/dashboard-headers.conf)). `X-Content-Type-Options: nosniff` on every API response. zod runs `jitless` in the browser so it does not probe `new Function`, which the CSP forbids ([`zod-setup.ts`](../apps/dashboard-web/src/lib/zod-setup.ts)). | `headers-robots.spec.ts` **[manual]**: `the policy nginx ships is strict`, `the shipped HTML has no inline script and no inline event handler`, `login and the not-found screen run under the policy without violations`. `route-coverage.test.ts`: `sends noindex and no-store on %s` (checks `nosniff`). Residual: `style-src` allows `'unsafe-inline'`, and no test renders hostile text such as `<script>` from a user agent through the UI. |
| CWE-89 SQL injection | Countered | Drizzle query builder and postgres.js tagged templates bind every value. The raw SQL that exists takes constants only: `sql.raw` in [`schema.ts`](../packages/db/src/schema.ts), the quoted `LISTEN` channel in [`listener.ts`](../apps/consent-api/src/listener.ts), and the migrator, which validates schema and table names with `IDENTIFIER` ([`migrator.ts`](../packages/db/src/migrator.ts)). | `authz.test.ts`: `a malformed site key is a 404 too, never a query` (includes a quote character). `migrations.test.ts`: `rejects unsafe journal identifiers`. `hostile-input.test.ts`. Residual: no test sends a classic injection string such as `' OR 1=1`. The protection is by construction. |
| CWE-78, CWE-77 OS command injection | Countered | No `child_process` or process spawn in application code (searched). Shell scripts in `infra/` and `scripts/` run only for the operator or CI. They were not audited line by line. | None needed for the application code. |
| CWE-94 Code injection | Countered | No `eval` or dynamic `Function` in application code. | None. |
| CWE-1236 CSV injection | Countered | `csvCell` prefixes a cell that starts with `=`, `+`, `-`, `@`, tab or carriage return with an apostrophe ([`csv.ts`](../apps/dashboard-api/src/csv.ts)). | `csv.test.ts`: `=SUM(A1:A9)`, `+1`, `-1`, `@cmd` and tab cases. `csv.fuzz.test.ts`: `every formula prefix is neutralised in front of any payload`. `c15t-read.test.ts`: `csv rows neutralize formulas and serialize purposes as JSON`. |
| CWE-20 Improper input validation | Countered | Section 3.10. zod at every boundary. | `site.fuzz.test.ts`, `network.fuzz.test.ts`, `request-guard.fuzz.test.ts`, `hostile-input.test.ts`. |
| CWE-22 Path traversal | Countered | `isSafePath` runs on the raw request target before routing, because `new URL` resolves `..` first. `siteKeyFromPath` allows only `[a-z0-9-]{3,40}`. nginx normalises paths too. No file is read from request data (no `fs` read in non-test source, searched). | `app.test.ts` (consent-api): `path rejection` (`..`, `%2e%2e`, `%2f`, `%5c`, double-encoded). `request-guard.test.ts`: `paths`. `request-guard.fuzz.test.ts`: `an accepted path cannot climb, split or smuggle a control character after decoding`. `nginx-snippet.test.sh` **[manual]**: `path traversal (..)`, `(%2e%2e)`, `(..%2f)`, `(double-encoded)`. `consent-flow.spec.ts` **[manual]**: `a site cannot be served under another site's hostname`. |
| CWE-434 Unrestricted upload | Not applicable | There is no upload, multipart or file-writing endpoint (searched). | None. |
| CWE-502 Deserialization of untrusted data | Countered | The only decoding of caller-supplied structure is `JSON.parse` of a pagination cursor, then a zod schema ([`pagination.ts`](../apps/dashboard-api/src/pagination.ts)). No YAML, no `v8.deserialize`. | `pagination.test.ts`: `rejects a forged cursor (%s) with a 400`. `hostile-input.test.ts`: `a forged consent cursor (%s) is a 400`. `c15t-read.test.ts`: `rejects a forged cursor`. `admin.test.ts`: `rejects a forged audit cursor`. |
| CWE-918 SSRF | Not applicable for our code | No application code makes an outbound HTTP request (searched for `fetch`, `http.request` and similar outside the browser app). `CONSENT_API_URL` is validated as a bare origin but dashboard-api does not call it yet ([`env.ts`](../apps/dashboard-api/src/env.ts)). The browser app calls only its own origin. `@c15t/backend` 3.1.0 does have outbound `fetch` calls: `dist/http/gvl.js` (default endpoint `https://gvl.inth.app`) and `dist/http/ad-tech-providers.js`. They run only when the matched policy model is `iab` and the Global Vendor List is enabled (`dist/http/init.js`). `instance.ts` sets no `gvl` option and no platform preset (`europeOptIn`, `quebecOptIn`, `usPrivacyStatesOptOut`, `worldNone`, `worldOptOutNoPrompt`) uses an `iab` model, so these paths are dormant. The target is a fixed default or an operator option, never request data. A new preset with an `iab` model would switch them on. | `env.test.ts` (dashboard-api): `validates the two optional variables when they are set`. No test covers the c15t paths. |
| CWE-352 CSRF | Countered | Cookies are `SameSite=Lax`. In addition, every `POST`, `PUT`, `PATCH` and `DELETE` under `/api/` must carry an `Origin` (or `Referer`) equal to `BETTER_AUTH_URL`; no header means rejection ([`app.ts`](../apps/dashboard-api/src/app.ts)). Better Auth's `trustedOrigins` is the same single origin. The `GET` routes of the dashboard API only read data. | `route-coverage.test.ts`: `rejects a write with %s (CSRF)` (no Origin, foreign Origin, `null`, foreign Referer) and `a same-origin Referer is enough when the browser sends no Origin`. `headers-robots.spec.ts` **[manual]**: in `every API answer, errors included, says noindex and no-store`, a sign-in with a foreign `Origin` returns 403. consent-api uses no cookie authentication, so CSRF does not apply there (but see T5). |
| CWE-862 Missing authorization | Countered | Section 3.3. Every route group attaches `requireSession`, `requireAdmin` or `requireSiteAccess`. | `route-coverage.test.ts`: `every route outside the allowlist answers 401 without a session`. `authz.test.ts`: `a user gets 403 on every admin route and nothing changes`. |
| CWE-863 Incorrect authorization, CWE-639 Authorization bypass through a user-controlled key (IDOR) | Countered | The site key in the URL is resolved against `accessibleSites` for the session. For a `user`, a missing, disabled or unassigned site is the same 404. An `admin` sees every site, including disabled ones. Every c15t query filters by the `TenantScope` that guard built, never by request input. Cursors cannot widen the scope. | `authz.test.ts`: `a user gets 404 on every read route of a site assigned to someone else`, `another site looks exactly like a site that does not exist (no enumeration)`, `a disabled site is invisible to its users but visible to admins`, `the record search of one site cannot be pointed at another site data`, `a cursor taken from one site cannot be replayed to read another site`. `c15t-read.test.ts`: `only returns rows of the tenants in the scope`, `a cursor cannot widen the scope`. `consent-flow.spec.ts` **[manual]**: `each reader sees only their own tenant: list, stats and CSV`. |
| CWE-306 Missing authentication for a critical function | Countered | The only routes outside the guards are `/api/health` and `/api/auth/*`, which is cut down to four endpoints. Admin bootstrap is a CLI that needs shell access and the database URL. | `route-coverage.test.ts`: `the only open routes are health and the Better Auth sign-in family`. `bootstrap.test.ts`: `creates an administrator with a one-time password that must be changed`. |
| CWE-287 Improper authentication | Partly | Better Auth with email and password. No sign-up. Sessions last 7 days and refresh daily. A ban or a revoked session applies on the next request. Password change revokes other sessions. | `authz.test.ts`: `a banned user is rejected: the old session dies and sign-in is refused`, `a revoked session is rejected at once`. `change-password.test.ts`: `other sessions are revoked even when the client omits or disables revokeOtherSessions`. Residual: no MFA. |
| CWE-307 Excessive authentication attempts | Partly | Better Auth rate limiter, stored in the database: 10 sign-ins per 5 minutes per client IP and path ([`auth.ts`](../apps/dashboard-api/src/auth.ts)). The IP comes from `X-Forwarded-For` set by nginx. | `authz.test.ts`: `login is rate limited per client IP`. Residual: a distributed attack across many IPs is not limited, and there is no per-account lockout. |
| CWE-521 Weak password requirements, CWE-798 Hard-coded credentials | Countered | Passwords are 12 to 128 characters. Admin-issued passwords are generated (about 115 bits) and must be changed. No default account and no credential in source; the first admin is created with `yarn admin:create`. Secrets are read from the environment by one module per app. Test and CI files hold only throwaway values for ephemeral databases. | `user.test.ts`: `rejects short, long and unchanged passwords`. `password.test.ts`. `bootstrap.test.ts`. `env.test.ts`: `rejects a short secret and an origin with a path`. `change-password.test.ts`: `the one-time password cannot be "changed" to itself, and the flag stays set`. Residual: no scan for secrets runs in CI (see Known gaps). |
| CWE-269 Improper privilege management | Countered | `mustChangePassword` has `input: false`, so no HTTP caller can clear it. Better Auth's admin plugin endpoints are not reachable. A user cannot ban or reset themselves, and the last active admin cannot be demoted or banned. | `auth.test.ts`: `mustChangePassword cannot be written by a client`. `authz.test.ts`: `the Better Auth admin endpoints are not a way around the API`. `admin.test.ts`: `the only active administrator cannot demote themselves; with two they can`. |
| CWE-613 Insufficient session expiration | Countered | `expiresIn` 7 days, `updateAge` 1 day, no cookie cache, `revokeSessionsOnPasswordReset`, sessions revoked on ban and password reset. | `authz.test.ts`: `a revoked session is rejected at once`. `admin.test.ts`: `resets a password: new one-time password, forced change, sessions revoked, audited`. `auth-roles.spec.ts` **[manual]**: `signing out invalidates the session on the server`. |
| CWE-200, CWE-209, CWE-532 Information exposure (data, errors, logs) | Countered | Errors use fixed text per code. Better Auth and driver messages never reach the client. Loggers write identifiers and codes, not bodies, headers, cookies or passwords. `errorFields` and `describeError` keep only name, message line and code. Env errors name variables, never values. | `errors.test.ts`: `an unexpected error is a generic 500 and the log has no stack, SQL or parameters`, `Better Auth errors map to a status but never forward their text`. `admin.test.ts`: `every admin response is JSON and never leaks SQL or stack traces`, and the one-time password test (not in logs, streams or audit). `app.test.ts` (consent-api): `an unexpected exception is a generic JSON 500 with no stack or message`. `env.test.ts`: `rejects a database URL that is not postgres, and never echoes it`. |
| CWE-1021 Clickjacking | Countered | CSP `frame-ancestors 'none'`. | `headers-robots.spec.ts` **[manual]**: `the policy nginx ships is strict` (asserts `frame-ancestors`). |
| CWE-601 Open redirect | Countered | The post-login target must start with `/`, not `//`, with no backslash ([`session.ts`](../apps/dashboard-web/src/session.ts)). | `session.test.ts`: `only same-origin paths are accepted as a post-login target`. |
| CWE-362 Race conditions | Partly | User administration takes a transaction-scoped advisory lock (`lockUserAdministration`), so two admins cannot each remove "the other" last admin. A site `PATCH` reads the row `FOR UPDATE`. The site-change `NOTIFY` is sent by a trigger inside the writing transaction. The registry re-reads when a notification lands during a lookup. | `registry.test.ts`: `a change notification that lands mid-lookup forces a fresh read`, `concurrent first requests share one lookup and one instance`. `migrations.test.ts`: `inserts and updates notify site_changed with the key`. **No test runs two admin changes concurrently**: `the only active administrator cannot demote themselves` is sequential. |
| CWE-400 Uncontrolled resource consumption | Partly | Body limits (1 MiB consent-api, 64 KiB dashboard-api, 1 MiB nginx on the dashboard), pagination limits, CSV streamed in batches of 500, small connection pools, request and header timeouts on the consent-api server, a bounded cache of unknown site keys. | `app.test.ts` and `route-coverage.test.ts`: `refuses an oversized body`. `streaming.test.ts`: `streams batch by batch: the first chunk arrives before the rest is read`, `stops querying when the client goes away`. `registry.test.ts`: `an unknown site is not found, and not looked up again until the negative TTL passes`. Residual: volume floods are not handled here (T5, T19). |
| CWE-327, CWE-328, CWE-330, CWE-338 Weak or misused cryptography and randomness | Countered | No custom primitive. Passwords use scrypt, generated passwords use `crypto.randomInt`, cookies use HMAC-SHA-256, release files use SHA-256 and cosign. `Math.random` appears once, for reconnect jitter. | See [`cryptography.md`](./cryptography.md). `password.test.ts`: `is different every time`. |
| CWE-787, 125, 416, 119, 476, 190 Memory safety | Not applicable | The repository is TypeScript, SQL and shell on Node.js. It has no native code of its own. Native code lives in Node.js and in dependencies. | None. |

### 4.3 Weaknesses specific to this design

| Weakness | Counter | Test |
|---|---|---|
| Spoofed client IP or jurisdiction (T2) | nginx replaces `X-Forwarded-*` and drops `Forwarded` and `X-Real-IP`. consent-api trusts forwarded headers only from `CONSENT_API_TRUSTED_PROXIES`, deletes all visitor override headers and the `country`, `region` and `gpc` query parameters from every request, and reduces `X-Forwarded-For` to one address. c15t is told to read only `x-forwarded-for`. | `app.test.ts`: `an untrusted peer cannot spoof the IP, the country or any forwarding header`, `a trusted peer cannot smuggle a visitor-chosen IP in front of the real one`, `the query parameters that override the geo headers never reach c15t`. `request-guard.test.ts`: `every country and region header the installed c15t reads is stripped or Cloudflare-only`. `integration.test.ts`: `/init resolves the Cloudflare country, whatever the visitor claims`. `nginx-snippet.test.sh` **[manual]**: `visitor IP comes from real_ip, client X-Forwarded-For is replaced`. `update-cloudflare-ips.test.sh` (CI): `out-dir run: real_ip file has every range`, `out-dir run: real_ip header is CF-Connecting-IP`. Limit: a caller that reaches the origin directly can still send `CF-IPCountry` and `cf-region-code` (T3). |
| Tenant chosen by the visitor (T1) | The tenant is the `siteKey` set by nginx in the path and resolved only through the registry. `requireTenantId` is on. The forwarded `Host` must belong to the site. | `integration.test.ts`: `a visitor cannot choose the tenant with a header, a cookie or a body field`, `site A's path under site B's domain is a 404, in both directions`. `app.test.ts`: `site A's path under site B's domain is a 404, and A's instance is never called`. `nginx-snippet.test.sh` **[manual]**: `tenant is not taken from headers or cookies`. |
| Stale tenant configuration after a site change or failover (T16) | A trigger sends `NOTIFY` inside the writing transaction; the listener reconnects and then drops every cached instance; a 5-minute TTL is the backstop. | `listener.test.ts`, `registry.test.ts`, `integration.test.ts`: `the listener reconnects after its connection is cut and sees later changes`, `changing the domains takes effect without a restart`. |
| Cacheable per-visitor answers | Every consent-api response carries `Cloudflare-CDN-Cache-Control: no-store` and `CDN-Cache-Control: no-store`; errors are `no-store`. | `app.test.ts`: `every kind of response forbids Cloudflare caching and defaults to no-store`, `an error response is never cacheable, whatever c15t said`. |

### 4.4 Residual risks: what is NOT protected

These are limits of the design, not bugs. Most are in [`security-model.md`](./security-model.md#what-is-not-protected),
which has the operator advice.

- **A script can still post consents.** Consent saves are not authenticated. In c15t 3.1.0, `trustedOrigins`
  only sets CORS response headers. Anyone who can reach a site's public endpoint can submit fake records.
  Consent counts are indicative, not proof that a person acted.
- **c15t's subject routes are not gated by an API key, so the subject ID works as a bearer secret.** All of
  this is in `@c15t/backend` 3.1.0, `dist/http/routes/subject.js`.
  - `GET /subjects/:id` has no authentication check. It returns the subject's `createdAt`, `externalId` and
    `identityProvider`, every consent with its choice, preferences and vendor choices, and the subject's
    overall choice and vendor choice.
  - `PATCH /subjects/:id` has no key requirement either. A caller that knows the ID can set or replace the
    subject's `externalId` and `identityProvider`, unless the current `externalId` is already verified.
    An `externalId` counts as verified only when the request carried the API key or a signed identity token
    (`identity-token.js`). This platform configures no `identityToken`, so only a request with the API key
    verifies. The change is written to the c15t `auditLog`.
  - `GET /subjects` (list by external ID) does require the key.
  - The ID is chosen by the client: the schema is `sub_` followed by base58 characters of any length
    (`@c15t/schema`, `subjectIdSchema`: "Client-generated subject ID"). The saver supplies it as `subjectId`
    in the request body, normally the c15t script.
  - The tenant check holds: a different site answers 404 (`integration.test.ts` (consent-api):
    `site A's reader gets the record, site B's does not`). Within the same site, that same test shows that the
    ID alone is the gate: it reads the record with no API key. No test covers `PATCH /subjects/:id`. The platform
    adds no check of its own on these routes. Short or predictable IDs, or IDs placed in URLs, logs or analytics,
    expose the record. The README (D4) says c15t's admin API covers
    "subject lookup by `externalId`". That holds for `GET /subjects` only, not for the routes above.
- **The origin must be locked down by the operator.** Without the firewall allowlist (and Authenticated
  Origin Pulls on the dashboard vhost), a direct caller can send any `CF-IPCountry` and `cf-region-code`, and so
  choose the jurisdiction. A `CF-Connecting-IP` from such a caller is not trusted: nginx `real_ip` accepts
  it only from Cloudflare ranges (`set_real_ip_from` per range, `real_ip_recursive off`, written by
  [`update-cloudflare-ips.sh`](../infra/nginx/update-cloudflare-ips.sh)), and consent-api strips it again. The
  recorded IP is then the caller's own address. The nginx integration test uses a loopback-only `real_ip`
  config (`infra/test/nginx/conf.d/realip-test.conf`), not the Cloudflare ranges file.
- **Direct callers can address any site.** A caller that reaches the consent-api port by IP or `localhost`
  skips the `Host` check (B4).
- **The audit log is append-only for the application only.** The triggers that refuse `UPDATE`, `DELETE` and
  `TRUNCATE` on `app.admin_audit` are owned by the `dashboard` role, the role dashboard-api logs in with and
  `yarn db:migrate` runs as. Code running as dashboard-api, or a database administrator, can drop or disable them.
  There is no hash chain or external copy.
- **Both services run as the same system user.** A code-execution bug in one service can probably read
  the other's secrets from `/proc/<pid>/environ` (3.7). Then the database role separation (B6) no longer holds.
- **dashboard-api trusts `X-Forwarded-For` from any peer.** `auth.ts` reads the client IP from that header with
  no trusted-proxy list. nginx replaces it, so this only matters if the dashboard-api port is reachable directly:
  a caller could then pick the IP and avoid the sign-in rate limit.
- **One `C15T_ADMIN_API_KEY` for every site.** consent-api passes the same key to every instance
  (`apiKeys: [config.apiKey]` in `instance.ts`). Whoever holds it is authorised on the key-protected c15t routes
  of every site.
- **Sessions slide and never expire absolutely.** `expiresIn` is 7 days and `updateAge` 1 day, so a session
  used at least once in 7 days stays valid until it is revoked, banned or signed out.
- **Reads are not audited.** `app.admin_audit` records admin changes. Consent searches and CSV exports by
  users or admins are not recorded.
- **No tamper evidence and no application-level encryption** of consent records.
- **No multi-factor authentication.** The rate limit is per IP, with no per-account lockout.
- **No TLS between nginx and the services**, and TLS to PostgreSQL only if the operator sets it.
- **Volume attacks.** consent-api has no rate limiter of its own.
- **Third-party flaws** stay until upstream patches and we upgrade.
- **The CSP allows inline styles.** XSS is mitigated, not eliminated.

---

## Known gaps

These are claims or checks that are missing, weaker than they sound, or not run automatically. We list
them so the case does not read stronger than the evidence.

1. **The Playwright suite and the Docker-based nginx test are not run by CI.** At the time of writing,
   `ci.yml` runs typecheck, lint, the SPDX check, the build, `yarn test`, and in the `verify` job the scripts
   `infra/test/uninstall.test.sh` and `infra/test/update-cloudflare-ips.test.sh`. `e2e/` and
   `infra/test/nginx-snippet.test.sh` are run by hand. Everything tagged **[manual]** above depends on that:
   the CSP assertions, the nginx header and path-traversal behaviour, and the end-to-end tenant checks.
2. **No concurrency test** for the advisory lock in `lockUserAdministration` or the `FOR UPDATE` on a site
   update. The sequential last-admin test passes, but a race is not exercised.
3. **No test for an unknown role string** being refused in `readSession` (`authz.ts`).
4. **No automated check of the systemd sandbox.** `systemd-analyze security` is run by hand.
5. **The `dashboard` role's inability to write `c15t.*`** is asserted for one table in
   `scripts/ci-bootstrap-db.sh`. No application test tries a write.
6. **No classic SQL-injection payload test.** The protection is bound parameters, shown by construction
   and by the validation tests.
7. **No test that renders hostile text** (such as `<script>` in a user agent or external ID) through the
   dashboard UI.
8. **No secret scanning is configured in the workflows in this repository** (we did not check the
   repository settings, so GitHub's own secret scanning may be on).
9. **`yarn npm audit` before a release is a manual step** ([`dependency-policy.md`](./dependency-policy.md)),
   not a CI job.
10. **`infra/deploy.sh` does not verify release signatures or provenance.** It builds from the tagged source.
11. **Failed sign-ins are not written to `app.admin_audit`**, which records admin actions only. Whether
    Better Auth logs them at the configured `warn` level was not checked.
12. **The `Host` check has three pass-through cases** (no header, IP literal, `localhost`), described in B4 and 3.2.
13. **c15t's `GET` and `PATCH /subjects/:id` need no API key** (4.4). The platform has no extra check and no
    test for `PATCH`.
14. **Both services run as one system user** (`c15t`), so the env files are hidden but the process
    environments are probably not (3.7). Not tested on a host. A separate user per service would fix it.
15. **The audit triggers are owned by the role dashboard-api uses** (3.6).
16. **The 403 list is hand-written.** `route-coverage.test.ts` proves only that every route answers 401 without
    a session. The check that a `user` gets 403 is a list of 12 admin routes in `authz.test.ts`
    (`a user gets 403 on every admin route and nothing changes`). A new admin route that is guarded by
    `requireSession` only would pass CI until someone adds it to that list. The admin route files attach
    `requireAdmin` once per file with `.use('*', ...)`, which reduces the chance.
17. **dashboard-api has no trusted-proxy list** for `X-Forwarded-For` (4.4).
18. **One API key serves every tenant** (4.4).
19. **No absolute session lifetime**, and **reads are not audited** (4.4).
20. **No test covers the dormant c15t outbound fetch paths** (GVL and ad-tech lists, CWE-918 in 4.2).

## Keeping this page true

- Change the code, the test and this page in the same pull request. The questions at the end of
  `security-model.md` apply to every change.
- When a claim here names a test, renaming or deleting the test is a change to this page.
- Re-check the c15t statements (4.3 and 4.4) after every `@c15t/*` upgrade, because they were verified
  against 3.1.0.
