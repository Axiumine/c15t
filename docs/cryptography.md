# Cryptography

This page lists every place where a cryptographic algorithm is chosen, who chooses it, and who can
change it. It answers one question for operators and reviewers: if an algorithm is broken, what do I
have to do?

Short answer:

- **The project implements no cryptographic primitive or protocol itself.** It calls Node.js
  (`node:crypto`, `node:tls`), Better Auth, nginx, PostgreSQL and Sigstore. This follows the rule in
  [`dependency-policy.md`](./dependency-policy.md): cryptography is never hand-written.
- **Transport algorithms** (TLS to the browser, TLS from Cloudflare to nginx, TLS to PostgreSQL, the
  PostgreSQL password method) are set by the operator in configuration. No code change is needed.
- **Application-layer algorithms** (password hashing, session cookie signature, generated passwords,
  release hashing and signing) are one fixed choice each. Changing one needs a code change by a
  maintainer.

How this relates to the [assurance case](./assurance-case.md) and the
[security model](./security-model.md): both rely on this page for the "no custom cryptography" claim.

Every statement below was checked against the pinned versions in `yarn.lock` (better-auth 1.7.14,
`@better-auth/utils` 0.5.1, better-call 1.4.4, `@c15t/backend` 3.1.0, `postgres` 3.4.9,
`@effect/sql-pg` 4.0.0) by reading the installed package sources. Where a fact comes from the project's
own documentation, or could not be checked from the repository, the text says so.

## Summary

| Use | Algorithm | Chosen in | Operator can change by configuration | Needs a code change |
|---|---|---|---|---|
| TLS, visitor or admin to Cloudflare | Negotiated by Cloudflare | Cloudflare account settings (not in this repository) | Yes, in the Cloudflare dashboard | No |
| TLS, Cloudflare to nginx | TLS 1.2 and 1.3. Cipher list: the nginx default | `ssl_protocols` in [`infra/nginx/dashboard.conf`](../infra/nginx/dashboard.conf) | Yes, edit the vhost and reload nginx | No |
| Authenticated Origin Pulls | Client certificate checked against `ssl_client_certificate` | Same vhost, plus Cloudflare | Yes, a different CA file | No |
| nginx to consent-api and dashboard-api | None. Plain HTTP on loopback or a private address | [`infra/nginx/c15t.conf`](../infra/nginx/c15t.conf), [`infra/nginx/dashboard-locations.conf`](../infra/nginx/dashboard-locations.conf) | Not applicable | Adding TLS needs nginx and service changes |
| Node.js to PostgreSQL | TLS when the URL says so (`sslmode`). Versions and suites: Node.js and the server | Connection URL and the PostgreSQL server | Yes | No |
| PostgreSQL role passwords | SCRAM-SHA-256 or MD5. The server decides | PostgreSQL (`password_encryption`, `pg_hba`) | Yes, on the server | No |
| Dashboard password hash | scrypt, N=16384, r=16, p=1, 64-byte key, random salt | Better Auth default | No switch. Only by overriding `hash` and `verify` in code | Yes |
| Generated one-time password | `crypto.randomInt` over a 55-symbol alphabet, 20 symbols | [`apps/dashboard-api/src/password.ts`](../apps/dashboard-api/src/password.ts) | No | Yes |
| Session cookie signature | HMAC-SHA-256, keyed with `BETTER_AUTH_SECRET` | better-call (inside Better Auth) | The key: yes (env file). The algorithm: no | Yes, or a library change |
| `C15T_ADMIN_API_KEY` check | String comparison inside c15t, see below | `@c15t/backend` | The key: yes (env file). The check: no | Upstream change |
| Release hashes | SHA-256 (`sha256sum`) | [`scripts/release-package.sh`](../scripts/release-package.sh), [`.github/workflows/release.yml`](../.github/workflows/release.yml) | No | Yes |
| Release signatures and provenance | cosign keyless (Sigstore), SLSA provenance | [`.github/workflows/release.yml`](../.github/workflows/release.yml) | No | Yes |

## Transport security

### Visitors and administrators to Cloudflare

Cloudflare terminates TLS for every website and for the dashboard (decisions.md D7). The protocol versions and
cipher suites at the edge, the certificate and HSTS are Cloudflare account settings. They are not in
this repository and the repository cannot enforce them. decisions.md D7 asks for SSL mode "Full (strict)".
HSTS is set at the edge, not in nginx (comment in
[`infra/nginx/dashboard.conf`](../infra/nginx/dashboard.conf)).

Change them in the Cloudflare dashboard (SSL/TLS, Edge Certificates). No deployment is needed.

### Cloudflare to nginx

[`infra/nginx/dashboard.conf`](../infra/nginx/dashboard.conf) sets:

- `ssl_protocols TLSv1.2 TLSv1.3;`. TLS 1.0 and 1.1 are not enabled.
- No `ssl_ciphers` directive. nginx uses its built-in default list, so the exact suites depend on the
  nginx and OpenSSL versions on the host. The repository does not pin them.
- `ssl_session_tickets off;`.
- `ssl_verify_client on;` with `ssl_client_certificate`. This is Authenticated Origin Pulls: nginx
  accepts only TLS clients that present a certificate signed by the configured CA. The shared
  Cloudflare CA proves "some Cloudflare zone". A per-zone certificate binds it to your zone (comment in
  the vhost, decisions.md D7).
- The origin certificate is a Cloudflare Origin CA certificate that the operator creates. Its key type
  is chosen when the operator creates it. The repository does not contain one.

The file is per-host: `infra/deploy.sh` does not overwrite it, so local TLS edits survive a deploy. To
change versions or suites, edit `ssl_protocols`, add `ssl_ciphers` or `ssl_ecdh_curve`, run `nginx -t`
and reload nginx.

The website vhosts are the operators' own. The project ships only the location snippet
[`infra/nginx/c15t.conf`](../infra/nginx/c15t.conf), which has no TLS settings.

[`infra/nginx/update-cloudflare-ips.sh`](../infra/nginx/update-cloudflare-ips.sh) downloads the
Cloudflare address ranges with `curl --proto =https --proto-redir =https`. It refuses any URL that is
not `https://` (a `file://` URL is accepted only together with `--out-dir`, for tests).

### nginx to the services

The hop from nginx to consent-api and dashboard-api is plain HTTP (`proxy_pass http://...`). It is
meant for loopback. Env validation lets the services bind only to a loopback or private address
(`hostSchema` in [`packages/shared/src/host.ts`](../packages/shared/src/host.ts), tested in
`apps/consent-api/src/env.test.ts`, "rejects the bind address"). If an operator binds a private LAN
address, that traffic is not encrypted. decisions.md D1 says to limit the port in the firewall. It also says
that `@c15t/node-sdk` refuses plain `http:` together with an API key for non-loopback hosts; that
statement comes from decisions.md and was not re-checked here.

### Node.js to PostgreSQL

Two drivers read the connection URL differently (decisions.md D9, "TLS to PostgreSQL"). What the installed
sources do:

| Driver | Used by | `sslmode=require` | `sslmode=verify-full` |
|---|---|---|---|
| postgres.js 3.4.9 | dashboard-api, migrations, the site registry and the `LISTEN` connection | Encrypts, does not verify the certificate (`src/connection.js` sets `rejectUnauthorized = false` for `require`, `allow` and `prefer`) | Encrypts and leaves Node's default verification on |
| `@effect/sql-pg` 4.0.0 | the per-site c15t pools in consent-api | Plain TLS with Node's trust store, so the certificate is verified (`dist/PgConnection.js` maps `require`, `verify-ca` and `verify-full` to `ssl = true`) | Same as `require` |

Operators should use `verify-full` when the database is on another host. A private CA goes into
`NODE_EXTRA_CA_CERTS` in the service environment file, never into the URL as `sslrootcert`
(decisions.md D9). TLS versions and suites come from Node.js and its bundled OpenSSL, and from the
PostgreSQL server settings. I checked Node's default minimum on Node 24 only (`TLSv1.2`), not on the
pinned Node 26.

Password authentication to PostgreSQL is chosen by the server. Both drivers implement MD5 and
SCRAM-SHA-256 (`postgres.js` `src/connection.js`; `@effect/sql-pg` `dist/PgConnection.js`). The
bootstrap script [`infra/postgres/init.sql`](../infra/postgres/init.sql) passes the role password to
`CREATE ROLE`, so the server's `password_encryption` setting decides how it is stored. Operators
should require SCRAM-SHA-256. This is a recommendation; the repository does not enforce it.

## Dashboard passwords

### Algorithm and stored format

Better Auth 1.7.14 hashes passwords in `dist/crypto/password.mjs`. On Node.js it delegates to
`@better-auth/utils` 0.5.1, `dist/password.node.mjs` (the `node` export condition of
`@better-auth/utils/password`). What that file does:

- The password is normalised with Unicode NFKC.
- scrypt from `node:crypto` with `N=16384`, `r=16`, `p=1` and a 64-byte output. `maxmem` is
  `128 * N * r * 2`. The memory use of one hash is `128 * N * r`, which is 32 MiB.
- The salt is 16 random bytes from `randomBytes`, written as 32 hex characters. Those 32 characters are
  passed to scrypt as the salt string.
- The stored value is `<salt hex>:<key hex>`.
- Verification derives the key again and compares the two hex strings with `===`. It does not use
  `crypto.timingSafeEqual`. The two compared values are scrypt outputs, not bytes the caller chose.

The value is stored in the `password` column of `app.account`
([`packages/db/src/schema.ts`](../packages/db/src/schema.ts)). I verified the format from the function.
I did not inspect a database row. The test
`creates a user with a one-time password that is stored only as a hash` in
[`apps/dashboard-api/src/admin.test.ts`](../apps/dashboard-api/src/admin.test.ts) checks that the stored
value is not the plain password and does not contain it. It does not check the format.

The scrypt parameters are fixed in `@better-auth/utils`. They are weaker than the minimum configurations
in the OWASP Password Storage Cheat Sheet. Better Auth uses N=16384, r=16, p=1 (32 MiB, a work factor
N*r*p of 262144). The sheet's minimums include N=2^17, r=8, p=1 (128 MiB, a work factor of 1048576). Check the
current version of the sheet, because it changes. The platform cannot change these values by configuration
(see Algorithm agility). Existing hashes would need a rehash path in code, which does not exist today.

The platform adds length limits: 12 to 128 characters (`minPasswordLength`, `maxPasswordLength` in
[`apps/dashboard-api/src/auth.ts`](../apps/dashboard-api/src/auth.ts) and `PASSWORD_MIN_LENGTH` in
[`packages/shared/src/user.ts`](../packages/shared/src/user.ts)).

### Can the algorithm be changed?

Yes, but not by configuration. The Better Auth option type has

```
emailAndPassword.password.hash?:   (password: string) => Promise<string>
emailAndPassword.password.verify?: (data: { hash: string; password: string }) => Promise<boolean>
```

(`@better-auth/core` `dist/types/init-options.d.mts`) and the context uses
`options.emailAndPassword?.password?.hash || hashPassword` (`better-auth` `dist/context/create-context.mjs`).
[`apps/dashboard-api/src/auth.ts`](../apps/dashboard-api/src/auth.ts) does not set them today. Switching
algorithms therefore means:

1. Write `hash` and `verify` in `auth.ts`. `verify` must accept both the old `<salt>:<key>` scrypt
   format and the new format, because existing hashes stay as they are until each password is set again.
2. I found no rehash-on-login logic in Better Auth 1.7.14 (`grep` for `rehash` in `dist`), so old hashes
   are replaced only when a user changes their password or an admin resets it.
3. Add tests, release a new version, and have operators deploy it.

No environment variable or setting switches the algorithm.

## Generated one-time passwords

[`apps/dashboard-api/src/password.ts`](../apps/dashboard-api/src/password.ts) builds a 20-symbol password
with `node:crypto` `randomInt` over a fixed 55-symbol alphabet (no `0`, `O`, `1`, `l`, `I`). That is about
115 bits (20 x log2 55). `randomInt` draws from the OpenSSL random generator and returns uniformly
distributed integers (Node.js documentation). The password is shown to the admin once. It is not stored,
logged or audited; the test named above checks the logs, the output streams and the audit row.

The alphabet and length are constants in the file. Changing them is a code change. The only other use of
randomness in application code is `Math.random` for reconnect jitter in
[`apps/consent-api/src/listener-timing.ts`](../apps/consent-api/src/listener-timing.ts), which has no security role.

## Sessions and cookies

- The session token is stored in a cookie named with the prefix `c15t-dashboard`. Better Auth signs the
  cookie value with HMAC-SHA-256 keyed with `BETTER_AUTH_SECRET` (`better-auth` `dist/cookies/index.mjs`
  calls `setSignedCookie`; better-call 1.4.4 `dist/crypto.mjs` fixes `{ name: "HMAC", hash: "SHA-256" }`
  and verifies with WebCrypto `verify`). The session itself is a database row, and the cookie cache is
  off ([`auth-options.ts`](../apps/dashboard-api/src/auth-options.ts), tested in `apps/dashboard-api/src/auth.test.ts`).
- `BETTER_AUTH_SECRET` must be at least 32 characters
  ([`apps/dashboard-api/src/env.ts`](../apps/dashboard-api/src/env.ts)). Better Auth also logs a warning
  when the secret looks low-entropy and refuses its built-in default secret in production
  (`dist/context/create-context.mjs`).
- The operator rotates the secret by editing `/etc/c15t-platform/dashboard-api.env` and restarting the
  service. Existing cookies then no longer verify, so users sign in again. This follows from the
  signature check; it is not covered by a test.
- The algorithm (HMAC-SHA-256) is fixed in better-call. This repository has no setting for it.

## The c15t API key

`C15T_ADMIN_API_KEY` is read by consent-api (at least 16 characters,
[`apps/consent-api/src/env.ts`](../apps/consent-api/src/env.ts)) and passed to every c15t instance as
`apiKeys: [key]` ([`apps/consent-api/src/instance.ts`](../apps/consent-api/src/instance.ts)). This
repository never compares the key itself. c15t does it in `@c15t/backend` 3.1.0, `dist/http/auth.js`:
the key is read from `Authorization: Bearer <key>` and compared with a hand-written loop that visits every
character when the lengths are equal and has no early exit. It does not use `crypto.timingSafeEqual`. The
key is stored as plain text in the service environment file (mode 0600). dashboard-api does not need it
(`C15T_ADMIN_API_KEY` is optional in its env schema; the test
`starts without C15T_ADMIN_API_KEY and CONSENT_API_URL, which nothing in dashboard-api uses yet` is in
`apps/dashboard-api/src/env.test.ts`).

Rotation: edit the environment file and restart consent-api. The instance factory passes one key, so
two keys cannot be accepted at the same time without a code change.

## Releases and supply chain

[`release.yml`](../.github/workflows/release.yml) and
[`scripts/release-package.sh`](../scripts/release-package.sh):

- SHA-256 for the file list `SHA256SUMS` and for the subjects of the SLSA provenance (`sha256sum`).
- Every release file gets a keyless cosign signature bundle (`cosign sign-blob --bundle`, cosign v3.0.6,
  Sigstore, identity bound to the release workflow through GitHub OIDC). The workflow verifies each
  signature right after it signs it.
- SLSA provenance comes from `slsa-framework/slsa-github-generator`
  `generator_generic_slsa3.yml@v2.1.0` (the one action referenced by tag, see
  [`dependency-policy.md`](./dependency-policy.md)).
- SBOMs are CycloneDX 1.6. They contain no cryptography.

The signature and key algorithms are decided by cosign and Sigstore, not by the project. Replacing SHA-256
means editing the workflow and the script. Verification commands for consumers are in
[`SECURITY.md`](../SECURITY.md). `infra/deploy.sh` builds from the tagged source and does not verify these
signatures; a consumer who wants that verifies the release before deploying.

## What is not encrypted or signed

Stated plainly, as in [`security-model.md`](./security-model.md):

- Consent records are not encrypted at application level and are not signed or hash-chained. Disk and
  backup encryption is the operator's job.
- The nginx to service hop has no TLS (see above).
- Dashboard accounts have no multi-factor authentication.

## Algorithm agility

This section is the answer to the OpenSSF criterion `crypto_algorithm_agility` ("support multiple
cryptographic algorithms, so users can quickly switch if one is broken").

What an operator can switch **by configuration alone** (edit a file, restart or reload, no new release):

1. TLS protocol versions and cipher suites at nginx, and at Cloudflare's edge.
2. The origin certificate and its key type, and the Authenticated Origin Pulls CA.
3. TLS mode and the CA for PostgreSQL connections (`sslmode`, `NODE_EXTRA_CA_CERTS`), and the PostgreSQL
   password method (server side).
4. The values of `BETTER_AUTH_SECRET` and `C15T_ADMIN_API_KEY`.

What needs a **code change** by a maintainer, followed by a release and a deployment:

1. Password hashing (scrypt, fixed in Better Auth's default). Possible through the
   `emailAndPassword.password.hash` and `verify` options, which `auth.ts` does not set. This is the case
   that matters most, because it protects stored credentials.
2. The session cookie signature (HMAC-SHA-256, fixed in better-call).
3. The generated password scheme and the release hashing (SHA-256).

Assessment. The project does not "support multiple algorithms" for the parts it controls: password
hashing and cookie signing are one fixed algorithm each, and there is no switch. The fixed scrypt
parameters are below OWASP's minimums, so the part that is hardest to change is also the part that is
weak today. For transport security,
which protects everything in transit, the project does not fix any algorithm and the operator can change
all of them by configuration. We do not claim full support. Whether the criterion counts as met is a
judgement call; this page gives the facts for it.
