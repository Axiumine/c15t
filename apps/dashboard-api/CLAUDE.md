# dashboard-api rules

These rules apply when you work under `apps/dashboard-api/`. They were moved out of the root `CLAUDE.md`, which keeps the cross-cutting rules (network, PostgreSQL, code conventions) and a short summary of each section.

## Dashboard data access (dashboard-api)

- c15t has **no admin endpoints for listing consents or stats**. dashboard-api reads the `c15t` schema directly, through a **read-only** Postgres role. It never writes to `c15t.*`.
- Every query against `c15t.*` filters by `tenantId IN (<sites the session can access>)`. Build the list in `authz.ts`, never from request input.
- c15t table names are camelCase (`"consentPolicy"`, `"auditLog"`), so quote them in raw SQL. Prefer the generated Drizzle types from `db:pull-c15t`. Rerun the pull after every c15t upgrade, and fix any type errors it causes.
- List endpoints use cursor pagination. CSV export streams rows from `db.analytics`, and never buffers a whole site in memory.
- Planned, **not implemented yet** (dashboard-api *will* use `@c15t/node-sdk`; it reads `c15t.*` directly today): use `@c15t/node-sdk` with the API key for the endpoints c15t does expose (`consents.check`, `legalDocuments.publish`, `experiments.summary`), with `baseUrl: ${CONSENT_API_URL}/s/<siteKey>`. dashboard-api has no SDK dependency and makes no such call, so `C15T_ADMIN_API_KEY` and `CONSENT_API_URL` are optional in its env schema; consent-api still requires the key (at least 16 characters). Make them required again in the same change that adds the first call.
- The SDK accepts plain `http:` with an API key **only for loopback hosts**. If `CONSENT_API_URL` points at a LAN address, the key-protected calls need TLS, or they must run on the consent-api host.

## Authorization (dashboard-api only)

- dashboard-api is the security boundary. Guards in dashboard-web are UX only, and the API never trusts them.
- All checks live in `apps/dashboard-api/src/authz.ts` (it wires the guards; the session loader, the site lookup and the `TenantScope` type are in `session.ts`, `site-access.ts` and `authz-types.ts` next to it):
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

## Credentials

- Better Auth `emailAndPassword: { enabled: true, disableSignUp: true }`, `trustedOrigins: [BETTER_AUTH_URL]`. The origin check is the CSRF guard. Cookies are httpOnly, Secure and `SameSite=Lax`.
- An admin creates each user with `auth.api.createUser` and a generated password. That password is shown to the admin **once**, and is never stored in plain text or logged.
- Admins can reset passwords (`setUserPassword`), ban or unban users, and revoke sessions. Every one of these actions is audited.
- Add rate limiting to login (the Better Auth rate limiter). The client IP comes from `X-Forwarded-For`, which nginx sets from the real visitor IP.
