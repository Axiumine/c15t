<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Axiumine -->

# Project status

## Status and what is next

Done and covered by tests (unit, PostgreSQL integration and Playwright end to end):

1. **Foundation:** the monorepo (Yarn 4 workspaces, Node 26), env validation with the network rules, Postgres roles and schemas, c15t migrations, and consent-api serving one c15t instance per site behind the nginx snippet.
2. **Access control:** dashboard-api with Better Auth, the admin bootstrap CLI, user management with one-time passwords, site management, memberships, the audit log and the route coverage test; the dashboard-web login, account and admin screens.
3. **Consent views:** per-site overview charts, record search, CSV export and the admin cross-site overview.
4. **Hardening:** the authz test suite (a user cannot read another site's data), the Playwright suite, login rate limits, the `/status` and `/api/health` endpoints, and `infra/deploy.sh` with rollback.

Still open:

- A 1.0 release. Until then, 0.x minor versions may contain breaking changes (see `CHANGELOG.md`; releases follow `CONTRIBUTING.md`).
- A retention job for consent records. It waits for the legal decision under Open questions.
- Monitoring on `/status` and `/api/health`, and the cluster backups ([D9](./decisions.md#d9-postgresql-runs-on-the-existing-patroni-cluster-5-nodes-etcd)). Both are the operator's job.
- Calling the c15t admin endpoints from dashboard-api through `@c15t/node-sdk` ([D4](./decisions.md#d4-the-dashboard-reads-c15t-tables-directly)). Nothing needs it yet.

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
