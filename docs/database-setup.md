<!--
SPDX-License-Identifier: AGPL-3.0-or-later
Copyright (C) 2026 Axiumine
-->

# Database setup

How to prepare PostgreSQL for the platform. For the reasoning behind the layout, see
[README D2](../README.md#d2-one-postgresql-database-two-schemas-two-roles) and
[D9](../README.md#d9-postgresql-runs-on-the-existing-patroni-cluster-5-nodes-etcd).

## What you are building

One database with two schemas and two login roles. Postgres itself enforces the boundaries.

| Role | Owns | Access |
|---|---|---|
| `c15t_api` | schema `c15t` (consent data) | read-write on `c15t.*`, `SELECT` on `app.site` only |
| `dashboard` | schema `app` (auth, sites, memberships, audit log) | read-write on `app.*`, `SELECT` only on `c15t.*` |

- `c15t_api` is used by consent-api (`DATABASE_URL_C15T`) and by the c15t migration CLI.
- `dashboard` is used by dashboard-api and the Drizzle migrations (`DATABASE_URL_DASHBOARD`).
- Neither role can create databases, create roles or create schemas. Someone with admin rights creates
  the database and both schemas once, and the roles then run their own migrations inside them.

## Prerequisites

- PostgreSQL 16 or newer, and `psql` on the machine you run the setup from.
- A superuser role (for example `postgres`). It is needed once, for the bootstrap, and never by the apps.
  On PostgreSQL 16 and newer a role with only `CREATEROLE` and `CREATEDB` is not enough: `init.sql` runs
  `ALTER ROLE ... NOSUPERUSER` and stops with `permission denied to alter role`.
- Node.js 26 and Yarn 4 for the migrations (see the toolchain notes in [`CLAUDE.md`](../CLAUDE.md)).
- `openssl`, or any other way to generate random passwords.

## 1. Bootstrap the roles, database and schemas

[`infra/postgres/init.sql`](../infra/postgres/init.sql) does the whole bootstrap. It is idempotent: it
drops nothing, skips roles and the database when they already exist, and leaves existing passwords alone.

```bash
export C15T_API_PW=$(openssl rand -hex 24)
export DASHBOARD_PW=$(openssl rand -hex 24)

psql -v ON_ERROR_STOP=1 \
     -v c15t_pw="$C15T_API_PW" -v dash_pw="$DASHBOARD_PW" \
     -v db=consent_dev \
     -d postgres -f infra/postgres/init.sql
```

Connect as your superuser (add `-h`, `-U` or a connection URL as needed). `db` defaults to
`consent_dev`; use another name for production.

What the script does:

1. Creates the roles `c15t_api` and `dashboard` with `LOGIN`, and no superuser, `CREATEDB` or `CREATEROLE`.
2. Creates the database, revokes access from `PUBLIC` and grants `CONNECT` to the two roles.
3. Creates the schemas: `c15t` owned by `c15t_api`, `app` owned by `dashboard`.
4. Locks down `public`: nothing from the platform lives there.
5. Grants `dashboard` read-only access to `c15t.*`, for tables that exist now and tables c15t creates later
   (`ALTER DEFAULT PRIVILEGES FOR ROLE c15t_api`).
6. Grants `c15t_api` `USAGE` on schema `app`. `SELECT` on `app.site` follows in step 3 below.

The schema `app` is created here, not by the Drizzle migration, because the `dashboard` role has no
`CREATE` privilege on the database. Our migrator (`applyMigrations` in `@consent/db`) skips Drizzle's
`CREATE SCHEMA IF NOT EXISTS` statement for the same reason.

## 2. Write the connection settings

Copy `env.example` to the repo-root env file once, then fill in the database lines:

```dotenv
DATABASE_URL_C15T=postgres://c15t_api:<C15T_API_PW>@<host>:5432/consent_dev
DATABASE_URL_DASHBOARD=postgres://dashboard:<DASHBOARD_PW>@<host>:5432/consent_dev
# DATABASE_URL_DASHBOARD_REPLICA=   (optional; leave unset locally)

C15T_ADMIN_API_KEY=<openssl rand -hex 32>
BETTER_AUTH_SECRET=<openssl rand -hex 32>
BETTER_AUTH_URL=http://127.0.0.1:5173
```

- A local database uses `127.0.0.1` as the host. A shared server uses its DNS name, for example
  `postgres.example.lan`.
- Passwords that contain URL-reserved characters must be percent-encoded. `openssl rand -hex` output never
  needs it.
- `C15T_ADMIN_API_KEY` must have at least 16 characters (consent-api rejects a shorter key). dashboard-api
  accepts the key but does not use it yet, so it is optional there (leave it out of `dashboard-api.env`);
  consent-api requires it.
- `BETTER_AUTH_SECRET` must have at least 32 characters.
- `BETTER_AUTH_URL` must be the origin the browser uses: the Vite dev server in development, the dashboard
  hostname in production. dashboard-api rejects writes from any other origin.
- Do not append to the file with `cat >>` a second time. A rerun would duplicate the keys.
- The env file is gitignored. Never commit it or paste it into an issue.

## 3. Run the migrations

Run them in this order, always against the primary (never a replica):

```bash
yarn c15t:plan          # read the plan before applying
yarn c15t:migrate       # creates the c15t tables and the c15t_migrations ledger (role c15t_api)
yarn db:migrate         # creates the app tables, triggers and grants (role dashboard)
yarn db:pull-c15t       # regenerates packages/db/src/c15t.generated.ts for the read-only queries
yarn admin:create --email you@example.com   # first admin; prints a one-time password
```

What `yarn db:migrate` installs besides the tables (`0001_guards`):

- `SELECT` on `app.site` for `c15t_api`, so consent-api can load the site registry. It never sees the auth tables.
- `site_key_immutable`: a site key cannot change after creation.
- `admin_audit_append_only` and `admin_audit_no_truncate`: audit rows cannot be updated, deleted or truncated.
- `site_changed_notify`: sends `NOTIFY site_changed, '<siteKey>'` on every insert or update of `app.site`, when
  the change commits. consent-api listens on that channel and rebuilds the matching c15t instance.

Re-run `yarn db:pull-c15t` after every c15t upgrade and fix the type errors it causes.

If `yarn c15t:migrate` ran before the default privileges existed, `dashboard` cannot read the c15t tables.
Fix it with one statement, as `c15t_api` (it owns the tables) or as an admin:

```sql
GRANT SELECT ON ALL TABLES IN SCHEMA c15t TO dashboard;
```

## 4. Verify

Run these with the matching URL (`psql "$DATABASE_URL_DASHBOARD"`, then `psql "$DATABASE_URL_C15T"`).

```sql
-- Neither role should be able to create databases or roles.
SELECT current_user, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user;

-- Schema ownership: c15t -> c15t_api, app -> dashboard.
SELECT nspname, pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname IN ('c15t', 'app');
```

As `dashboard`, after the migrations:

```sql
SELECT has_table_privilege('dashboard', 'c15t."consentPolicy"', 'SELECT')  AS read_c15t,   -- true
       has_table_privilege('dashboard', 'c15t."consentPolicy"', 'INSERT')  AS write_c15t;  -- false
```

As `c15t_api`:

```sql
SELECT has_table_privilege('c15t_api', 'app.site', 'SELECT')    AS read_site,   -- true
       has_table_privilege('c15t_api', 'app.site', 'UPDATE')    AS write_site;  -- false
```

c15t table names are camelCase, so they must be double-quoted in raw SQL.

## Shared or managed servers

Sometimes an administrator creates the database and the roles for you, for example on a shared LAN
Postgres. That is fine as long as the end state matches section 1. Ask for:

- a database, with both schemas in it, owned as in the table above;
- the two roles, with the `CONNECT` privilege and `CREATE` on their own schema only;
- the default privileges for `dashboard` on `c15t.*`.

Then continue at step 2. The apps never need `CREATEDB` or `CREATEROLE`.

Check your connection budget first: the platform shares `max_connections` with everything else on the server.
Keep pools small (c15t per-site instance 2 to 3, dashboard-api at most 10) and, if you want a hard cap, set
`ALTER ROLE c15t_api CONNECTION LIMIT 30;` and `ALTER ROLE dashboard CONNECTION LIMIT 15;`.

## Production on Patroni

- Run the bootstrap once, on the **primary**. Everything replicates to the other nodes.
- Reach the primary only through its internal DNS name, which is repointed on failover. Never connect to a
  node by its own name or IP, and never pin a resolved address.
- `pg_hba` entries for `c15t_api` and `dashboard` go into Patroni's configuration (`postgresql.pg_hba` in the
  DCS), never into a node's `pg_hba.conf`.
- `DATABASE_URL_DASHBOARD_REPLICA` is optional and points at replicas. It serves only read-only analytics over
  `c15t.*`. Migrations and everything in `app.*` stay on the primary.
- Do not put PgBouncer in transaction mode in front of the primary: prepared statements break. Connect directly.
- TLS: use `sslmode=verify-full` when the nodes are on other hosts. Never put `sslrootcert=<file>` in a URL:
  postgres.js (dashboard-api, the site registry, migrations) sends it to Postgres as a startup parameter,
  which Postgres rejects. For a private CA, set `NODE_EXTRA_CA_CERTS=<ca bundle>` in both service env files
  instead. It covers postgres.js and the `@effect/sql-pg` driver that c15t uses (which verifies the
  certificate even for `sslmode=require`; postgres.js does not). See README D9, "TLS to PostgreSQL".
- Make sure the cluster's backups include this database.

## Rotating a password

```sql
ALTER ROLE dashboard PASSWORD '<new password>';
```

Then update the matching `DATABASE_URL_*` value in the env file (`/etc/c15t-platform/*.env` in production) and
restart the service. Rerunning `init.sql` does not change existing passwords.

## Tests and CI

The integration tests run against a real Postgres and need no extra privileges: they use the schemas above, and
each run uses unique prefixes for site keys and email addresses and deletes only the rows it created. CI starts a
throwaway Postgres, runs `init.sql` and the same migrations. Do not point tests at a database that holds real
consent data.

To run these tests on your own machine, start from [`local-database.md`](./local-database.md): a throwaway server
without root, a separate test database, every environment variable and the e2e suite.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `permission denied for schema c15t` or `app` | The role is not the owner and lacks `USAGE`. Rerun `init.sql`. |
| `permission denied to create schema` / `permission denied for database` | A migration tried `CREATE SCHEMA`. Create the schemas as an admin (step 1), and use `yarn db:migrate`, which skips that statement. |
| `permission denied for table ...` from dashboard-api on `c15t.*` | Missing `SELECT` for `dashboard`. Run the `GRANT SELECT ON ALL TABLES IN SCHEMA c15t` statement above. |
| consent-api returns 404 for every site | `c15t_api` cannot read `app.site`: run `yarn db:migrate`, or check the grant in `0001_guards`. |
| `role "c15t_api" already exists` with a hand-written script | Use `init.sql`, which checks first. |
| `25006 read_only_sql_transaction` or `57P01 admin_shutdown` | Failover in progress, or the URL points at a replica. The apps return 503 and reconnect. Check that the primary URL points at the primary. |
| `too many connections` | The shared server's budget is used up. Lower the pool sizes or raise `max_connections`. |

## Resetting a development database

Only on a database that holds no real consent data. Consent records are legal proof, so production data is
never dropped or edited by hand.

```sql
DROP SCHEMA c15t CASCADE;   -- as c15t_api
DROP SCHEMA app  CASCADE;   -- as dashboard
```

Then recreate both schemas as in step 1 and rerun the migrations.
