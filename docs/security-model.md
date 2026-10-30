# Security model

This is a summary of what the platform protects, against whom, and where it does not protect you. It is
written for operators and reviewers. The design reasoning is in the [README](../README.md) (decisions
D1 to D11), the coding rules are in [`CLAUDE.md`](../CLAUDE.md), and vulnerabilities are reported as
described in [`SECURITY.md`](../SECURITY.md).

## Assets

| Asset | Why it matters |
|---|---|
| Consent records (`c15t` schema) | Legal proof of what a visitor agreed to. Integrity and per-site confidentiality matter. |
| Dashboard accounts, sessions and the audit log (`app` schema) | They control who can see which site. |
| `C15T_ADMIN_API_KEY`, `BETTER_AUTH_SECRET`, database URLs | Server-side secrets. They live in the systemd environment files under `/etc/c15t-platform/` (mode 0600), never in the repository or in the browser bundle. |
| The visitor's IP address and country | Used to resolve the jurisdiction. c15t masks IP addresses by default. |

## Actors and trust boundaries

```
Visitor browser --(HTTPS)--> Cloudflare --> nginx (per-site vhost) --> consent-api --> PostgreSQL (role c15t_api)
Admin / user browser --(HTTPS)--> Cloudflare --> nginx --> dashboard-api --> PostgreSQL (role dashboard)
Website server code ----------------------------------------> consent-api (CONSENT_API_URL, API key)
```

| Actor | Trusted? | Notes |
|---|---|---|
| Visitor (anonymous) | No | Can call the public consent endpoints of the site whose vhost they visit, nothing else. |
| Website server code | Partly | Holds the API key for the key-protected c15t endpoints on its own host. |
| Dashboard `user` | Limited | Read-only, only for assigned sites. |
| Dashboard `admin` | Yes | Can see every site and manage users. Their actions are audited. |
| nginx, Cloudflare | Yes, for the headers they set | consent-api trusts forwarded headers only from configured proxies. |
| Anyone who can reach the origin directly | No | See "What is NOT protected". |

## What is protected, and how

### Tenant isolation (consent-api)

- One c15t instance per site, with `tenantId = siteKey` and `requireTenantId: true`, so a failed lookup
  can never write a consent with an empty tenant.
- The tenant is resolved only from the `siteKey` in the URL path, which nginx sets from its own vhost
  configuration. It is never taken from a header, a cookie or a request body. Unknown or disabled
  sites return 404. consent-api also checks that the forwarded `Host` belongs to that site.
- Paths containing `..` or encoded slashes are rejected before routing.
- `trustedOrigins` is validated to be non-empty and free of `*` and `*.example.com` when a site is saved and
  again when its instance is built. In the pinned c15t 3.1.0 the list only controls the CORS response
  headers: an empty list lets no cross-origin browser read the answers, and a wildcard would let every
  origin (or every subdomain) read them. It does not authenticate consent saves (see "What is NOT
  protected"). The validation keeps the CORS policy tight, and does not make the endpoints private.
- Site domains are bare host names without a port. The nginx snippet forwards `$host`, which has no
  port. Validation still accepts a `host:port` entry, but the runtime `Host` check can never match it, so
  the site would get 404 for every request.
- consent-api binds only to a loopback or private address (env validation rejects `0.0.0.0`, `::` and
  public IPs) and has no public hostname.

### Spoofable client data (trusted proxies)

- The visitor IP comes from `CF-Connecting-IP`, restored by nginx's `real_ip` module that trusts only
  Cloudflare ranges. The country comes from `CF-IPCountry`.
- The firewall allowlist (nftables table `inet c15t_cloudflare`) is what keeps other hosts away from ports
  80 and 443. It is loaded into the kernel only after `CF_NFT_APPLY=1`, and it survives a reboot only after
  `systemctl enable --now c15t-cloudflare-nft.service` (or an `include` line in `/etc/nftables.conf`). Until
  then the origin is open at every boot (README D7 and section 5). The `cloudflare-ips` unit runs as root
  with a systemd sandbox; `/run` stays writable for it because `nginx -t` opens `/run/nginx.pid`.
- consent-api reads the TCP peer address. When the peer is not in `CONSENT_API_TRUSTED_PROXIES`, it deletes
  `X-Forwarded-*`, `CF-*` and `Forwarded` before the request reaches c15t. Visitor overrides for country,
  region and GPC (headers and query parameters) are stripped as well, and malformed country and region
  codes are dropped.

### Authorization (dashboard-api)

- dashboard-api is the only security boundary. The route guards in dashboard-web are a convenience.
- All checks live in `apps/dashboard-api/src/authz.ts` (`requireSession`, `requireAdmin`,
  `requireSiteAccess`). `/api/admin/*` needs an admin (403 otherwise). A site a user may not access returns
  404, so site keys cannot be enumerated.
- Every query on the `c15t` schema filters by the tenant IDs computed for the session, never by request
  input. Users are read-only.
- A route coverage test calls every route without a session and expects 401, except an explicit allowlist
  (`/api/auth/*`, `/api/health`), so a new route fails CI until it is guarded.
- While `mustChangePassword` is set, every route except `/api/me`, change-password and sign-out returns 403.
- Admin mutations write to `app.admin_audit` in the same transaction.

### Credentials and sessions

- No public sign-up. Admins create users with a generated password (20 characters drawn with
  `node:crypto` `randomInt`), shown once and never stored in plain text or logged. Password hashing and
  session handling are Better Auth's, with no custom cryptography in this repository.
- Login and change-password are rate limited (stored in the database, so limits survive restarts).
- Cookies are httpOnly, Secure and `SameSite=Lax`, with an origin check against `BETTER_AUTH_URL` as the
  CSRF guard. The session cookie cache is off, so a ban or a revoked session applies on the next request.
- Admins can reset passwords, ban users and revoke sessions. All of these actions are audited.

### Database

- Two roles with least privilege: `c15t_api` owns `c15t` and can `SELECT` only `app.site`; `dashboard`
  owns `app` and can `SELECT` only on `c15t.*`. dashboard-api never writes consent data.
- No role can create databases, roles or schemas. Migrations run against the primary.
- Pools are small, and drop connections after a failover. What each client does differs (README D9 has the
  table): the postgres.js pools (dashboard-api, migrations, the site registry and the `LISTEN` connection)
  require `target_session_attrs=read-write` on the primary, a 5 s connect timeout, TCP keepalive and a
  5-minute connection lifetime. consent-api's per-site c15t pools use `@effect/sql-pg` 4.0.0, which has no
  `target_session_attrs`: they have the keepalive socket, the connect timeout and the 5-minute lifetime, and
  rely on evicting the instance after a database error and retrying reads once. A connection that is still
  on a demoted node can therefore live for up to five minutes. A write on it is rejected with `25006` and the
  client gets 503; a read on it may be stale until the connection is replaced. Consent records are never deleted from the dashboard.
- TLS to PostgreSQL is the operator's choice (`sslmode` in the URL). A private CA needs
  `NODE_EXTRA_CA_CERTS`, not `sslrootcert` (README D9, "TLS to PostgreSQL").

### Dashboard delivery

- A strict CSP (same-origin scripts), `X-Robots-Tag: noindex, nofollow` on every response, and
  `Cache-Control: no-store` on `/api/*`. The bundle contains no secrets.
- CSV export neutralises formula injection (cells starting with `=`, `+`, `-`, `@`, tab or carriage
  return) and streams rows instead of buffering.
- systemd units run as the unprivileged `c15t` user with `NoNewPrivileges`, `ProtectSystem=strict` and
  `PrivateTmp`.

### Supply chain

Exact dependency pins and a committed `yarn.lock`, Dependabot, dependency review, CodeQL, OpenSSF
Scorecard, GitHub Actions pinned by commit SHA (one documented exception: the SLSA generator, which is
referenced by tag), and signed releases with provenance. See
[`dependency-policy.md`](./dependency-policy.md) and [`scorecard.md`](./scorecard.md).

## What is NOT protected

Please read this section before you rely on the platform.

| Gap | Consequence | What you can do |
|---|---|---|
| The origin is reachable without Cloudflare (the firewall and Authenticated Origin Pulls are the operator's job, README D7) | Anyone can forge `CF-Connecting-IP` and `CF-IPCountry`, and so the recorded IP and jurisdiction. | Restrict ports 80 and 443 to Cloudflare ranges and enable Authenticated Origin Pulls. |
| Consent saves are not authenticated. In c15t 3.1.0 `trustedOrigins` only sets CORS response headers (browsers enforce them, other clients ignore them) and no route checks the `Origin` | Anyone who can reach a site's public endpoint can submit fake consent records, with or without an `Origin` header. The platform does not prove that a record came from a real visitor. | Use Cloudflare rate limiting and treat counts as indicative. |
| No tamper evidence | A database administrator, or an attacker with write access to the primary, can change consent records. There is no signing or hash chain. | Restrict database access, keep backups and database auditing. |
| No application-level encryption | Records are protected by Postgres permissions and by disk or backup encryption only. | Encrypt disks and backups. |
| No built-in multi-factor authentication for dashboard accounts | A stolen password gives access to that user's sites. | Put Cloudflare Access (Zero Trust) in front of the dashboard (README, Security notes). |
| Subject IDs are unique across the whole database, not per site (c15t behaviour) | A conflicting save returns `409 SUBJECT_CONFLICT`. IDs should be treated as non-secret. | Do not use predictable subject IDs. |
| Public consent endpoints can be flooded | Denial of service or database growth by volume traffic. | Cloudflare rate limits and firewall rules. |
| A compromised server or root user | Secrets under `/etc/c15t-platform/` and the database are exposed. systemd hardening limits damage but is not a sandbox against root. | Standard host hardening. |
| XSS in the dashboard is mitigated by the CSP, not eliminated | A script injection bug could act with the victim's session. | Keep the CSP strict, and report any bypass. |
| Third-party code (c15t, Better Auth, Hono, ...) | A vulnerability upstream is a vulnerability here until patched. | Follow the dependency policy and update promptly. |
| Legal compliance (GDPR, ePrivacy, CCPA, ...) | The software records consent, it does not make a site compliant. Retention rules and purging are not implemented (README, Open questions). | Get legal advice. |

## Assumptions

- PostgreSQL, nginx, Cloudflare and the operating system are configured and patched by the operator.
- Only Cloudflare (or other trusted proxies listed in `CONSENT_API_TRUSTED_PROXIES`) can reach the
  services, and the services are not exposed on a public interface.
- Admins are trusted and keep their credentials safe.

## Reviewing a change for security

Ask these questions. Does it add a route (is it guarded and in the coverage test)? Does it read the
`c15t` schema (is it filtered by the session's tenant IDs)? Does it take a tenant from request data (it
must not)? Does it read client IP or geo data (it must come from the sanitised headers)? Does it add a
dependency (see the dependency policy)? Does it change a database grant?
