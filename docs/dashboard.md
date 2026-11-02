<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Axiumine -->

# Dashboard reference

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

## Screens (dashboard-web)

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

## API (dashboard-api)

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
