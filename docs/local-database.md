<!--
SPDX-License-Identifier: AGPL-3.0-or-later
Copyright (C) 2026 Axiumine
-->

# A PostgreSQL for development, the tests and the end-to-end suite

You have no PostgreSQL yet and you want `yarn dev`, `yarn test` and `yarn test:e2e` to run. This guide takes you
from nothing to a working local server, a dev database and a separate test database, and lists every
environment variable the programs read.

Prerequisites: Node.js 26, Corepack and a finished `yarn install` (the steps are in
[`CONTRIBUTING.md`](../CONTRIBUTING.md#development-setup)), `openssl` for random passwords, and the PostgreSQL
programs of section 2. Run every command from the repository root unless it says otherwise. If your checkout sits
inside another checkout (a `git worktree`), read rule 5 of [section 5.1](#51-the-dotenv-file-the-shell-and-which-one-wins)
before your first `yarn` command.

It does not repeat the reasoning behind the roles, schemas and grants. That is in
[`database-setup.md`](./database-setup.md), which also has the production and Patroni notes. Read its
[section 1](./database-setup.md#1-bootstrap-the-roles-database-and-schemas) if you want to know what
`infra/postgres/init.sql` creates.

Status marks used below:

- **Verified**: run on Debian 13, PostgreSQL 16.15, Node 26.13.0, Yarn 4.18.1, `@c15t/cli` 3.1.0 (November 2026), and
  the output quoted here is what it printed.
- **Not run here**: written from the packaging documentation. Check it on your machine.

The throwaway server in this guide listens on `127.0.0.1` only, on port 54331. CI uses PostgreSQL 17, and any
version from 16 up should work.

## 1. What needs a database

Most tests need no server. The consent-api integration test and the e2e suite need a real PostgreSQL, and the
dashboard-api suites run on both PGlite and a real server.

| Suite | Database |
|---|---|
| `packages/*` (`@consent/db`, `@consent/shared`) | None. The migration tests run the real migration files in PGlite, an in-process Postgres. |
| `apps/dashboard-web` | None. jsdom and Testing Library. |
| `apps/consent-api`, 12 of its 13 test files | None. |
| `apps/consent-api/src/integration.test.ts` | **Real PostgreSQL only.** It needs both roles and the `C15T_ADMIN_API_KEY`. |
| `apps/dashboard-api`, 10 test files | **Both.** Each suite runs once on PGlite and once on the real database. |
| `apps/dashboard-api`: `ddl.test.ts`, the `last administrator` suite of `admin.test.ts`, and one test of the `admin routes` suite (`a failing audit insert rolls back the change, user or site`) | PGlite only. The last one installs a trigger (`test.runIf`), so on a real server Vitest lists it as skipped. |
| `scripts/` tests and `infra/test/*.test.sh` | None. (`nginx-snippet.test.sh` needs Docker, not a database.) |
| `yarn test:e2e` (`e2e/`) | **Real PostgreSQL**, plus Chromium. The website scenario also needs Docker. |

### How the choice is made

There is no switch for you to set. [`suite.ts`](../apps/dashboard-api/src/testing/suite.ts) wraps every shared
dashboard-api suite in `describe.each(['pglite', 'postgres'])`, so both variants run in `yarn test`, in CI and in
every run you start. The `postgres` variant ([`environment.ts`](../apps/dashboard-api/src/testing/environment.ts))
reads `DATABASE_URL_DASHBOARD` and `DATABASE_URL_C15T` and connects. `timezone.test.ts` does the same by hand.

One internal variable narrows the list: `C15T_TEST_ENVIRONMENTS=pglite` drops the `postgres` variants. Only
`stryker.config.mjs` sets it, for the mutation run, so that run can never reach a shared database
([`quality-gates.md`](./quality-gates.md#mutation-testing-strykerjs)). Any other value, or no value, keeps both.
Do not set it in the dotenv file or the shell: a green run must mean that the database was used.

### What happens when the variables are unset

A missing variable never skips a test and never falls back to PGlite only. A green run must mean that the database
was used, so a missing variable is an error. (The one skip in a green run is the PGlite-only test above, which has
nothing to do with the variables.)

| Program | Result (verified) |
|---|---|
| `yarn test`, dashboard-api suites | The `postgres` variants fail with `DATABASE_URL_DASHBOARD is not set, so the real-database tests cannot run.` The PGlite variants still pass. The run exits with code 1. Vitest lists the tests inside the failed suite as "skipped"; that is a side effect of the failure, not a skip. |
| `yarn test`, consent-api | `integration.test.ts` fails to load: ``The consent-api integration tests need DATABASE_URL_C15T, DATABASE_URL_DASHBOARD, C15T_ADMIN_API_KEY. They are not skipped: run them with `yarn vitest run --project consent-api` so Yarn injects the dev env file.`` The other 12 files pass. |
| `yarn test:e2e` | [`playwright.config.ts`](../playwright.config.ts) throws before any server starts: "DATABASE_URL_DASHBOARD is not set: run the suite with yarn test:e2e (see docs/e2e.md)". It checks `DATABASE_URL_DASHBOARD`, `DATABASE_URL_C15T`, `BETTER_AUTH_SECRET` and `C15T_ADMIN_API_KEY`, in that order (with only the two URLs set, the message is `BETTER_AUTH_SECRET is not set`). |
| `yarn db:migrate` | `DATABASE_URL_DASHBOARD is not set. Yarn injects it from the dev env file.` Exit 1. |
| `yarn c15t:plan`, `yarn c15t:migrate` | `error: Failed to load backend config DATABASE_URL_C15T is not set`. Exit 1. |
| `yarn admin:create` | `Invalid environment:` followed by one line per missing variable. Exit 1. |

The command in that message is the one that works. `yarn workspace @consent/consent-api test` does not (section 6).

If the variables are set but the schemas are not migrated, the two programs fail in different ways (verified on a
database that only `init.sql` had prepared):

| Program | Result |
|---|---|
| `yarn test`, dashboard-api suites | The `postgres` variants fail with `Error: The app or c15t schema is not migrated. Run yarn db:migrate and yarn c15t:migrate.` The PGlite variants pass. |
| `yarn test`, consent-api | `integration.test.ts` shows a raw driver error, `PostgresError: relation "app.site" does not exist`, and its 25 tests are listed as skipped. The message above is not used here. |

## 2. Get a server

### 2a. Debian or Ubuntu packages (not run here)

This needs `sudo`. The packages start a cluster called `main` on port 5432 right away.

```bash
sudo apt install postgresql postgresql-client   # server and psql; use the default version, 16 or newer
pg_lsclusters                                    # version, cluster name, port, status, data directory
sudo systemctl status postgresql@16-main         # the unit is postgresql@<version>-<cluster>
```

`pg_lsclusters` is verified (it printed `16 main 5432 online` here). If port 5432 is taken, or you want a cluster
only for this project, create one (`man pg_createcluster` lists `-p`/`--port` and `--start`):

```bash
sudo pg_createcluster 16 c15t --port 54331 --start
pg_lsclusters
sudo systemctl status postgresql@16-c15t
```

Debian's `pg_hba.conf` uses `peer` for the Unix socket and `scram-sha-256` for `127.0.0.1`. That is why every
command below passes `-h 127.0.0.1`.

The server package matters. `postgresql-client-<version>` has `psql` but no `initdb`, `pg_ctl` or `postgres`.
On the machine used for this guide `/usr/lib/postgresql/18/bin` held only client tools.

### 2b. A throwaway server without root (verified)

This runs a private server as your own user, in a folder you choose, with no packages beyond the server binaries.
Nothing outside that folder changes.

```bash
# The server programs. Debian and Ubuntu keep them out of PATH, one folder per major version.
ls /usr/lib/postgresql/
export PATH=/usr/lib/postgresql/16/bin:$PATH     # use a version that lists initdb
command -v initdb pg_ctl psql                    # all three must print a path

# English messages. Export this BEFORE initdb: the server's own messages follow the locale that initdb saw.
export LC_MESSAGES=C

# Where everything lives (private to you), and a password for the admin role.
export C15T_PG_DIR=$HOME/c15t-dev-pg
mkdir -p "$C15T_PG_DIR" && chmod 700 "$C15T_PG_DIR"
(umask 077; openssl rand -hex 16 > "$C15T_PG_DIR/admin.pw")

# Create the cluster. -U names the first role (a superuser), --auth makes every login use a password.
initdb -D "$C15T_PG_DIR/data" -U c15t_admin --pwfile="$C15T_PG_DIR/admin.pw" \
       --auth=scram-sha-256 -E UTF8

# Start it: TCP on 127.0.0.1:54331 only, no Unix socket.
pg_ctl -D "$C15T_PG_DIR/data" -l "$C15T_PG_DIR/server.log" -w \
       -o "-p 54331 -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" start
```

What it printed:

```text
Success. You can now start the database server using:
    pg_ctl -D <your folder>/data -l logfile start
waiting for server to start.... done
server started
```

Messages follow your locale. `initdb` writes the locale it saw into `postgresql.conf` as `lc_messages`, so
`LC_MESSAGES=C` must be exported **before** `initdb`, as in the block above. Set later, it changes only `psql` and
`pg_ctl`; the server's own errors (`FATAL: database "nodb" does not exist`) stay in the old language. For a cluster
that already exists, add `-c lc_messages=C` to the `-o` string of `pg_ctl start`. Verified both ways on an Italian
locale.

Check it:

```bash
pg_ctl -D "$C15T_PG_DIR/data" status     # pg_ctl: server is running (PID: ...)
pg_isready -h 127.0.0.1 -p 54331         # 127.0.0.1:54331 - accepting connections
```

Notes:

- Port 54331 is arbitrary. The packaged server usually owns 5432 (it did here), so pick a free port.
- **Why no Unix socket:** the socket file path may not exceed 107 bytes. A long folder name makes the server
  refuse to start with `Unix-domain socket path "..." is too long (maximum 107 bytes)`. A short folder
  (`-c unix_socket_directories=$HOME/pgsock`) works, but TCP is all this project needs.
- `--auth=scram-sha-256` also covers the `local` lines of `pg_hba.conf`. With no socket they are unused.
- The server stays up until you stop it or the machine restarts. To start it again, run the `pg_ctl ... start`
  command, but only after `pg_ctl -D "$C15T_PG_DIR/data" status` says that the server is not running: a second
  start of a running cluster fails (section 9). A new shell needs `PATH`, `C15T_PG_DIR` and `LC_MESSAGES` exported
  again.
- To stop it and delete everything, see [section 10](#10-stop-and-delete).

## 3. Create the roles and the databases

[`init.sql`](../infra/postgres/init.sql) creates the roles `c15t_api` and `dashboard`, one database and the two
schemas. Run it **as a superuser**. Verified on PostgreSQL 16.15: a role that has only `CREATEROLE` and
`CREATEDB` stops at the first `ALTER ROLE` (psql exit code 3) with
`permission denied to alter role` / `Only roles with the SUPERUSER attribute may change the SUPERUSER attribute.`
The comments in `init.sql` and `ci-bootstrap-db.sh` and [`database-setup.md`](./database-setup.md) say the same.

- Rootless server (2b): `c15t_admin` is already a superuser.
- Packaged server (2a), not run here: create it once, with the same folder layout as 2b so that the next block
  works for both. Use your cluster's port instead of 5432 if you made one.

  ```bash
  export C15T_PG_DIR=$HOME/c15t-dev-pg
  mkdir -p "$C15T_PG_DIR" && chmod 700 "$C15T_PG_DIR"
  (umask 077; openssl rand -hex 16 > "$C15T_PG_DIR/admin.pw")
  printf '%s\n' "CREATE ROLE c15t_admin LOGIN SUPERUSER PASSWORD :'pw';" \
    | sudo -u postgres psql -p 5432 -v ON_ERROR_STOP=1 -v pw="$(cat "$C15T_PG_DIR/admin.pw")" -d postgres
  ```

  (The password is visible in the process list while the command runs. That is fine on a private machine.) This role
  lives inside the system cluster, so deleting `$C15T_PG_DIR` later does not remove it: section 10 has the clean-up.

Now bootstrap. The same command creates the dev database and a second database for tests. The roles are
cluster-wide, so the second run finds them and leaves their passwords alone; it still needs the two `-v` values.
With a packaged server, set `PGPORT` to its port (5432 for the `main` cluster) here and in every URL below.

```bash
export PGHOST=127.0.0.1 PGPORT=54331 PGUSER=c15t_admin
export PGPASSWORD=$(cat "$C15T_PG_DIR/admin.pw")

export C15T_API_PW=$(openssl rand -hex 24)
export DASHBOARD_PW=$(openssl rand -hex 24)

# From the repository root:
for db in consent_dev consent_test; do
  psql -v ON_ERROR_STOP=1 \
       -v c15t_pw="$C15T_API_PW" -v dash_pw="$DASHBOARD_PW" -v db="$db" \
       -d postgres -f infra/postgres/init.sql
done
```

First run output (verified, abridged): `CREATE ROLE` twice, `ALTER ROLE` twice, `CREATE DATABASE`, `REVOKE`,
`GRANT`, `You are now connected to database "consent_dev" as user "c15t_admin".`, `REVOKE`, `CREATE SCHEMA` twice,
then `GRANT`, `ALTER DEFAULT PRIVILEGES` and two more `GRANT` lines. The second run prints no `CREATE ROLE`.

The passwords are visible in the process list (`ps`) while the `psql -v` commands run, and so is the `sed` command of
section 5.1. That is fine on a private machine. On a shared one use `scripts/ci-bootstrap-db.sh` (section 7): it
hands the passwords to `psql` through a private file.

Keep `C15T_API_PW` and `DASHBOARD_PW` in this shell until section 5 has written them into a file. `init.sql`
never changes the password of a role that exists. If you lose them, set new ones:

```bash
printf '%s\n' "ALTER ROLE dashboard PASSWORD :'d';" "ALTER ROLE c15t_api PASSWORD :'c';" \
  | psql -v ON_ERROR_STOP=1 -v d="$DASHBOARD_PW" -v c="$C15T_API_PW" -d postgres
```

When the databases exist, drop the admin settings from this shell, so that no tool picks them up by accident:

```bash
unset PGHOST PGPORT PGUSER PGPASSWORD
```

### Is there a separate test database?

The code has no test-database setting. Every suite reads the same two URLs as the dev servers. A separate test
database is therefore only a second database (`consent_test` above) that you point the URLs at while you test.
Verified: the whole suite passes against it and leaves the dev database alone (see [section 5](#5-environment-variables)
for how to switch).

## 4. The connection URLs

```text
DATABASE_URL_C15T=postgres://c15t_api:<password>@127.0.0.1:54331/consent_dev
DATABASE_URL_DASHBOARD=postgres://dashboard:<password>@127.0.0.1:54331/consent_dev
```

| Part | Rule |
|---|---|
| Scheme | `postgres://` or `postgresql://`. Both are accepted. |
| User | `c15t_api` in `DATABASE_URL_C15T`, `dashboard` in `DATABASE_URL_DASHBOARD`. Not the admin role. |
| Host and port | `127.0.0.1` and your port (54331 in this guide; 5432 for a packaged `main` cluster). Use the same database name in both URLs. |
| Password | Percent-encode reserved characters. `openssl rand -hex` output needs none. |
| `sslmode` | Leave it out for a local server. See below. |

**Special characters in a password.** Encode it:

```bash
node -p 'encodeURIComponent(process.argv[1])' 'p@ss:w/rd#1%2 x?&=+'
# p%40ss%3Aw%2Frd%231%252%20x%3F%26%3D%2B
```

Verified with both drivers: postgres.js (`yarn db:migrate`) and `@effect/sql-pg` (`yarn c15t:plan`) connected with the
encoded form. The raw form is not a valid URL (`ERR_INVALID_URL` in Node), and the apps reject it with
`Must be a postgres:// or postgresql:// URL with a host`.

**`sslmode`.** The local server has no TLS. Verified against it:

| URL ends with | postgres.js (`db:migrate`, dashboard-api) | `@effect/sql-pg` (`c15t:plan`, consent-api) |
|---|---|---|
| nothing, `?sslmode=disable` or `?sslmode=prefer` | works | works |
| `?sslmode=require` | `ECONNRESET`: `Client network socket disconnected before secure TLS connection was established` | `PgConnection: Server refused TLS` |

Production and private CAs are in [`database-setup.md`](./database-setup.md#production-on-patroni).

**`search_path` and time zone.** The apps set them, so you do not.

| Program | `search_path` | Time zone |
|---|---|---|
| consent-api and the c15t CLI (`@effect/sql-pg`) | `c15t` | UTC (startup parameter) |
| dashboard-api, `db:migrate`, `admin:create` (postgres.js) | not set; the code names the schema (`app.site`, `c15t."consent"`) | UTC (startup parameter) |
| `psql` by hand | `"$user", public`, so `select * from consent` fails with `relation "consent" does not exist`. Write `c15t."consent"`. | the server's |

**The replica URL.** `DATABASE_URL_DASHBOARD_REPLICA` is optional. Leave it unset locally; dashboard-api then
reads analytics from the primary. Verified: pointing it at a plain single server does **not** work. The pool asks for
a standby (`prefer-standby`), and postgres.js fails the query with `write CONNECTION_DESTROYED`. `yarn test` does
not read it, and the e2e runner sets it to an empty string for its dashboard-api.

## 5. Environment variables

### 5.1 The dotenv file, the shell, and which one wins

You can give a variable to a program in two ways.

**In the dotenv file** (`.env` in the repository root, git-ignored). Copy [`env.example`](../env.example) and fill
it in. The repository's Yarn configuration sets `injectEnvironmentFiles: ['.env?']`, so every `yarn <script>`
(including `yarn vitest`, `yarn playwright` and `yarn node`) starts with the variables of that file. The `?` means
the file may be missing. Yarn injects it. The c15t CLI and drizzle-kit also read a dotenv file in the current
folder themselves (rule 7). A plain `node`, `tsx` or `vitest` that you start without Yarn, and production services
under systemd, do not read it.

Create it only if you have no `.env` yet that you want to keep.

```bash
cp env.example .env
chmod 600 .env
sed -i \
  -e "s|^DATABASE_URL_C15T=.*|DATABASE_URL_C15T=postgres://c15t_api:${C15T_API_PW}@127.0.0.1:54331/consent_dev|" \
  -e "s|^DATABASE_URL_DASHBOARD=.*|DATABASE_URL_DASHBOARD=postgres://dashboard:${DASHBOARD_PW}@127.0.0.1:54331/consent_dev|" \
  -e "s|^C15T_ADMIN_API_KEY=.*|C15T_ADMIN_API_KEY=$(openssl rand -hex 32)|" \
  -e "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$(openssl rand -hex 32)|" \
  -e "s|^BETTER_AUTH_URL=.*|BETTER_AUTH_URL=http://127.0.0.1:5173|" .env
```

(GNU `sed`. On macOS use `sed -i ''`, or edit the file by hand. The passwords are visible in the process list while
`sed` runs, as in section 3. The `cp`, `chmod` and `sed` lines were run on a copy of `env.example` under another file
name; `git check-ignore` confirms that `.env` and `.env.*` are ignored.) Never commit the file or paste it into an
issue.

**In the shell**, for one command or one session: `export DATABASE_URL_DASHBOARD=...`.

**Precedence (all verified with test files and the real `env.example`):**

1. **The file beats the shell.** If both define a name, Yarn's value is what the script sees.
2. **An empty value in the file beats the shell too.** `env.example` has five keys with no value
   (`DATABASE_URL_C15T`, `DATABASE_URL_DASHBOARD`, `C15T_ADMIN_API_KEY`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`).
   After a plain `cp`, an `export` of one of them is blanked by Yarn. Fill the keys, or delete the lines.
3. A name the file does not define keeps the shell value.
4. With several files the **later one wins**.
5. **A checkout inside another checkout** (a `git worktree` below the repository, for example `.claude/worktrees/...`)
   gets the outer file too, **even when the inner folder has no dotenv file at all**. Yarn merges the configuration
   of the parent folders, so `injectEnvironmentFiles` lists the outer file first and the inner one after it. The
   outer file is injected in full. Every `yarn` script in the nested checkout (`yarn test`, `yarn db:migrate`,
   `yarn admin:create`, `yarn c15t:migrate`: they write to and delete from the database) can therefore reach the
   database that the outer file names, and your own `export` is overridden for each name that file defines (rule 1).
   Names missing from the inner file come from the outer one, so a half-filled inner file can run against the outer
   file's database too. `yarn config get injectEnvironmentFiles` lists the paths and reads no file. Run it first and
   expect only your own file. If it lists more, set `YARN_INJECT_ENVIRONMENT_FILES` (below) before the first
   `yarn` script. Verified in a worktree with no dotenv file of its own: a marker value that was exported for
   `DATABASE_URL_DASHBOARD` did not reach `yarn node`.
6. Without Yarn nothing is injected: `node -p 'process.env.DATABASE_URL_DASHBOARD'` prints `undefined`.
7. The c15t CLI (`yarn c15t:plan`, `yarn c15t:migrate`) also loads a dotenv file in the current folder itself (via
   c12), even when Yarn injects nothing, but only for names that are not set yet. drizzle-kit (`yarn db:pull-c15t`)
   looks for one too (`packages/db/scripts/pull-c15t.mjs`, not run). Under `yarn` the injected file has already set
   the names, so rule 1 applies: the file still beats the shell. The shell wins only where Yarn injects nothing for
   that name (approach (b) below). Verified with a probe config: with no Yarn the shell value beat the file in the
   current folder, and with Yarn injecting a file that sets the name the file's value won.

**Using another database for one run.** Do not `export` over a name that the file defines: rule 1 undoes it. Pick one:

```bash
# (a) A second file with only the names to change. Later wins (rule 4); .env.* is git-ignored.
(umask 077; cat > .env.test <<EOF
DATABASE_URL_C15T=postgres://c15t_api:${C15T_API_PW}@127.0.0.1:54331/consent_test
DATABASE_URL_DASHBOARD=postgres://dashboard:${DASHBOARD_PW}@127.0.0.1:54331/consent_test
EOF
)
export YARN_INJECT_ENVIRONMENT_FILES="$PWD/.env?,$PWD/.env.test?"
yarn c15t:migrate --yes && yarn db:migrate     # once, into consent_test
yarn test                                      # now runs against consent_test

# (b) No file: export the names in the shell and have Yarn inject nothing.
export DATABASE_URL_C15T=postgres://c15t_api:<password>@127.0.0.1:54331/consent_test
export DATABASE_URL_DASHBOARD=postgres://dashboard:<password>@127.0.0.1:54331/consent_test
export C15T_ADMIN_API_KEY=$(openssl rand -hex 32)
export YARN_INJECT_ENVIRONMENT_FILES='/nonexistent/none?'
yarn test
```

In (b) export the three names that `yarn test` reads. `yarn test:e2e` also needs `BETTER_AUTH_SECRET` (it sets
`BETTER_AUTH_URL` itself). Setting `YARN_INJECT_ENVIRONMENT_FILES` to a file that does not exist is also how you shut
out an outer file in a nested checkout (rule 5). Running `node_modules/.bin/vitest run` directly gives the same
result without Yarn.

`YARN_INJECT_ENVIRONMENT_FILES` replaces the whole list (comma separated, `?` allowed). Verified: it works as a
shell variable and replaces any outer file as well. Unset it to go back to the default. Because (a) layers on top
of `.env`, `C15T_ADMIN_API_KEY` and the other names still come from there. In a nested checkout the same
variable also drops the outer file, so list it in the value if you want it.

### 5.2 The variables

"Required" means the program stops with an error when the variable is missing. Defaults live in each app's
`src/env.ts` (zod) and in `vite.config.ts`.

**Database and secrets: put these in the dotenv file.**

| Variable | `yarn dev` | Migrations, `admin:create` | `yarn test` | `yarn test:e2e` | Meaning, example shape |
|---|---|---|---|---|---|
| `DATABASE_URL_C15T` | consent-api: required | `c15t:plan`, `c15t:migrate`: required | required | required | Role `c15t_api`. `postgres://c15t_api:<password>@127.0.0.1:54331/consent_dev` |
| `DATABASE_URL_DASHBOARD` | dashboard-api: required | `db:migrate`, `admin:create`, `db:pull-c15t`: required | required | required | Role `dashboard`. `postgres://dashboard:<password>@127.0.0.1:54331/consent_dev` |
| `C15T_ADMIN_API_KEY` | consent-api: required, 16 characters or more | not read | required (not empty) | required, 16 characters or more (the runner checks only "not empty", the server it starts enforces 16) | Bearer key for c15t. `openssl rand -hex 32`. dashboard-api accepts it but does not use it. |
| `BETTER_AUTH_SECRET` | dashboard-api: required, 32 characters or more | `admin:create`: required | not read | required, 32 characters or more (same check as above; a short value shows up later as a web server start error) | Session signing secret. `openssl rand -hex 32` |
| `BETTER_AUTH_URL` | dashboard-api: required | `admin:create`: required | not read | not needed; the runner sets it | The origin the browser uses, scheme, host and port exactly: an `http(s)` origin with no path, query or credentials (a trailing slash is dropped). Dev: `http://127.0.0.1:5173` |
| `DATABASE_URL_DASHBOARD_REPLICA` | optional, default unset | not read | not read | forced to empty by the runner | Leave unset locally (section 4). An empty value counts as unset. |

The URLs must be `postgres://` or `postgresql://` URLs with a host. The apps check that. The migration tools
(`c15t:plan`, `c15t:migrate`, `db:migrate`, `db:pull-c15t`) only check that the variable is not empty, so a malformed
URL fails later inside the driver (`ERR_INVALID_URL`).

The first five have no default. Without `C15T_ADMIN_API_KEY`, consent-api refuses to start, and `yarn test` fails
at `integration.test.ts`.

**Network and pools: optional, the defaults are fine. Already in `env.example` as comments.**

| Variable | Read by | Default | Meaning |
|---|---|---|---|
| `CONSENT_API_HOST`, `CONSENT_API_PORT` | consent-api | `127.0.0.1`, `4100` | Bind address and port. An IP literal (or `localhost`, not another host name), loopback or private LAN only. Port 1024 to 65535. |
| `DASHBOARD_API_HOST`, `DASHBOARD_API_PORT` | dashboard-api, Vite proxy | `127.0.0.1`, `4200` | Same rules. |
| `DASHBOARD_WEB_DEV_PORT` | Vite | `5173` | Dev server port. It binds `127.0.0.1` and proxies `/api`. `BETTER_AUTH_URL` must carry the same port. |
| `CONSENT_API_TRUSTED_PROXIES` | consent-api | `127.0.0.1/32,::1/128` | CIDRs allowed to send `X-Forwarded-*` and `CF-*`. |
| `CONSENT_API_INSTANCE_POOL_MAX`, `CONSENT_API_REGISTRY_POOL_MAX` | consent-api | `2`, `2` | Connections per site and for the registry (1 to 3). |
| `CONSENT_API_DB_PREPARE` | consent-api | `true` | Exactly `true` or `false` (`yes` is an error). `false` only behind PgBouncer in transaction mode. |
| `CONSENT_API_URL` | dashboard-api | unset | Reserved, not used yet. An `http(s)` origin with no path when set. |

`yarn test` ignores these. The e2e runner picks free ports and sets them for its own servers.

**Empty values.** The two apps differ (verified with their `parseEnv`). In consent-api every empty value counts as not
set, so the default applies where there is one. In dashboard-api an empty value means "unset" only for
`DATABASE_URL_DASHBOARD_REPLICA`, `CONSENT_API_URL` and `C15T_ADMIN_API_KEY`. An empty `DASHBOARD_API_HOST` or
`DASHBOARD_API_PORT` is a start-up error. After `cp env.example`, do not uncomment such a line and leave it empty:
delete the line, or give it a value. Rule 2 of section 5.1 makes the empty value beat your `export`.

**Shell only, for one run: do not put these in the dotenv file.**

| Variable | Read by | Meaning |
|---|---|---|
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` | `psql`, `pg_isready`; postgres.js (the apps, `db:migrate`, `admin:create`) as a fallback for any part that a URL leaves out | libpq settings for the **admin** role. Unset them after the bootstrap, so that no tool picks them up by accident. |
| `PGPASSWORD` (required), `PGHOST`, `PGPORT`, `PGUSER` (defaults `127.0.0.1`, `5432`, `postgres`) | `scripts/ci-bootstrap-db.sh` | The admin role. The script sets `PGDATABASE=postgres` itself and ignores yours. |
| `YARN_INJECT_ENVIRONMENT_FILES` | Yarn | Replaces the list of injected files (section 5.1). |
| `C15T_API_PW`, `DASHBOARD_PW` | `psql -v` in this guide; `scripts/ci-bootstrap-db.sh` (optional there) | The two role passwords. |
| `CI_DB_NAME`, `GITHUB_ENV` | `scripts/ci-bootstrap-db.sh` | Database name (default `consent_ci`) and the file that receives the results (required). |
| `C15T_ADMIN_API_KEY`, `GITHUB_ACTIONS` | `scripts/ci-bootstrap-db.sh` | The script uses your `C15T_ADMIN_API_KEY` when it is set and generates one otherwise. `GITHUB_ACTIONS=true` makes it print `::add-mask::` lines. |
| `TZ` | Node, tests | Optional. CI sets `UTC`. Every test file also passed here under Europe/Rome (CET); the timezone suite checks six zones itself. |
| `NODE_EXTRA_CA_CERTS` | Node | Only for TLS to a private CA. Not needed locally. |
| `E2E_RUN_ID`, `E2E_PORT_*`, `NGINX_TEST_*` | `playwright.config.ts`, `e2e/support` | Set by the runner for one run. Do not set them. |
| `C15T_TEST_ENVIRONMENTS` | `apps/dashboard-api/src/testing/suite.ts` | Internal. Exactly `pglite` limits the dashboard-api suites to PGlite; anything else keeps PGlite and the real database. `stryker.config.mjs` sets it for the mutation run (section 1). Do not set it. |

## 6. Run it

From the repository root, after `yarn install` and with the dotenv file in place. Every output here was seen.

**First check which file Yarn will inject.** These commands write to the database and some delete from it, and they
ignore your own `export` for every name that the injected file defines (rules 1 and 5 of section 5.1).

```bash
yarn config get injectEnvironmentFiles     # lists paths only; expect just your own file
```

If it lists an outer file (a nested checkout), run `export YARN_INJECT_ENVIRONMENT_FILES="$PWD/.env?"` first, or the
value of approach (a) or (b), before every command below.

**Migrate (in this order, both against the primary):**

```bash
yarn c15t:plan          # first run: "Database shape: Empty", 8 steps to the 2.0.0 baseline, 8 migrations
yarn c15t:migrate --yes # "Migration completed. 8 adoption step(s), 8 migration(s)."
yarn db:migrate         # "[db] app schema is up to date (2 migration(s) applied)"; a second run says 0
```

`--yes` accepts the confirmation prompt, which a terminal may show. After this, `c15t` holds 8 tables and `app`
holds 9. Counts change with c15t upgrades.

**First admin:**

```bash
yarn admin:create --email you@example.com
# Created administrator you@example.com
# One-time password (shown once, change it at the first login): <password>
```

The same email twice prints `A user with the email you@example.com already exists`. A different email creates
another admin. Without `--email` it prints the usage line.

**Dev stack:** `yarn dev` starts consent-api, dashboard-api and Vite. Verified on spare ports (consent-api
`/health` returned `{"status":"ok"}`, `/status` returned `"listener":"listening"`, and `/api/health` through the
Vite proxy returned `{"status":"ok","db":true}`). Open the exact origin you put in `BETTER_AUTH_URL`.

**Unit and integration tests:**

```bash
yarn test                                     # everything: 99 files, about 1392 tests passed at the time of writing
yarn vitest run --project consent-api         # one workspace
yarn vitest run --project dashboard-api
yarn vitest run apps/consent-api/src/integration.test.ts   # one file
```

A green run ends with `Tests  1392 passed | 4 expected fail | 1 skipped (1397)` (the counts grow as tests are
added). The 4 "expected fail" are `test.fails` tests that record known gaps in the code; the run stays green while a
gap exists, and a fixed gap turns its test red until the marker is removed. The 1 skipped test is the PGlite-only
test of section 1. Neither one means that a variable was missing.

It took 14 to 75 seconds here, depending on caches and a cold start. Do not use
`yarn workspace @consent/consent-api test`: that workspace does not list `vitest`, and Yarn answers
`command not found: vitest`.

**End-to-end:**

```bash
yarn playwright install chromium   # once; the browser matching the pinned Playwright
yarn test:e2e                      # 57 tests, 30 to 70 seconds
yarn test:e2e e2e/auth-roles.spec.ts e2e/headers-robots.spec.ts e2e/a11y.spec.ts   # without Docker: 50 tests
```

Besides the database it needs:

- Chromium from `yarn playwright install chromium` (it was already installed here: `chromium-1248`).
- Docker with Compose and the `nginx:stable-alpine` image, for `e2e/consent-flow.spec.ts` only. Both runs above
  passed. The runner starts a test nginx container with host networking and removes it at the end.
- Free ports (it picks four between 20000 and 32000) and a second loopback address next to the first one
  (`127.0.0.2` on Linux).
- `BETTER_AUTH_SECRET` and `C15T_ADMIN_API_KEY` in the environment. It sets `BETTER_AUTH_URL` and the ports itself.

The run id is `e2e-<8 hex>`, and the teardown prints how many rows it removed:
`e2e cleanup e2e-79693fda: 9 users, 7 sites, 16 consents removed`. More in [`e2e.md`](./e2e.md).

## 7. The same thing in CI

CI does not run the e2e suite. It runs `yarn test` against a PostgreSQL container that the job starts itself.

| What | In [`ci.yml`](../.github/workflows/ci.yml) |
|---|---|
| Runner | The self-hosted runners, job `test` (a pull request from a fork: `ubuntu-24.04`), see [`ci-runners.md`](./ci-runners.md) |
| Server | Container `postgres:17`, pinned by digest, started by `scripts/ci-start-postgres.sh` on a random free port from 50001 to 65535, published on `127.0.0.1` only. The bootstrap script waits until it accepts connections |
| Admin | User `postgres`, password in `CI_PG_ADMIN_PASSWORD` (a throwaway literal in the workflow) |
| Bootstrap | `bash scripts/ci-bootstrap-db.sh` with `PGHOST=127.0.0.1 PGPORT=<the random port> PGUSER=postgres PGPASSWORD=...`. `PGPORT` has no default |
| What the script does | Runs `init.sql` with generated passwords (database `consent_ci`), `yarn c15t:migrate --yes`, `yarn db:migrate`, then checks roles, ownership and grants as in `database-setup.md` section 4 |
| Variables it writes to `GITHUB_ENV` | `DATABASE_URL_C15T`, `DATABASE_URL_DASHBOARD`, `C15T_ADMIN_API_KEY` (masked). That is all `yarn test` needs: `YARN_INJECT_ENVIRONMENT_FILES=<that file> yarn test` passed here (1392 tests). |
| Test step | `yarn test --coverage.enabled ...` with `TZ=UTC` |

You can run the script on your throwaway server. Verified, with the limits below:

```bash
(umask 077; : > "$C15T_PG_DIR/ci.env")     # the script appends to this file, so create it private first
YARN_INJECT_ENVIRONMENT_FILES='/nonexistent/none?' \
GITHUB_ENV="$C15T_PG_DIR/ci.env" CI_DB_NAME=consent_ci \
C15T_API_PW="$C15T_API_PW" DASHBOARD_PW="$DASHBOARD_PW" \
PGHOST=127.0.0.1 PGPORT=54331 PGUSER=c15t_admin PGPASSWORD=$(cat "$C15T_PG_DIR/admin.pw") \
bash scripts/ci-bootstrap-db.sh

# Use the result: Yarn injects only that file, as in approach (a) of section 5.1.
YARN_INJECT_ENVIRONMENT_FILES="$C15T_PG_DIR/ci.env" yarn test
```

- It refuses to run without `GITHUB_ENV` (`GITHUB_ENV is not set; refusing to print secrets`). The file named there
  receives the three variables, URLs included. Treat it like a dotenv file: without the `umask` line the script
  creates it with the default mode (664 here), which any other user of the machine can read.
- Without `C15T_API_PW` and `DASHBOARD_PW` it resets the role passwords, which breaks the URLs of your other
  databases.
- It runs `yarn` itself, so a dotenv file would win over the URLs it passes (rule 1 of section 5.1). The first
  line of the command turns the injection off for this run. Sections 3 and 6 are the safer path.

## 8. Safety

- **Use a database that nobody else needs.** Never point the tests at a database with real consent data. The
  tests only touch their own rows, but they run `INSERT`, `DELETE` and, in one test, `pg_terminate_backend`.
- **Every run uses its own prefix, and cleanup deletes only rows that carry it:**

  | Suite | Prefix | How it deletes |
  |---|---|---|
  | dashboard-api | `dapi-<16 hex>-` in site keys and emails | `LIKE 'dapi-<hex>-%'`; refuses a malformed prefix |
  | consent-api | `t-<8 hex>-` in site keys; domains `a-<hex>.example.test` | the exact keys it created |
  | e2e | `e2e-<8 hex>-` in site keys, host names, emails | `starts_with(...)` on the full run id, in one transaction |

- **Audit rows stay.** `app.admin_audit` is append-only on purpose, so cleanup cannot remove its rows. One full
  `yarn test` left 37 of them in an empty test database, and a dev database held 95 after two full runs and one
  e2e run. Users, sites and consents were gone (checked: 0 each). If the table matters, reset the database
  (below).
- **The dashboard never deletes consent records**, because they are legal proof. Only test cleanup deletes
  consent rows, and only those of its own run prefix.
- **The consent-api failover test cuts connections.** It ends backends of role `c15t_api` whose
  `application_name` starts with `consent-api` and that started after the test began. Do not run it against a
  database that a real consent-api serves.
- **A shared server** (a LAN Postgres other people use): every test file that uses the real database opens up to
  six connections, Vitest runs several files at once, and e2e runs three workers. The default `max_connections`
  is 100. Prefer your own server (section 2b).
- **Reset a development database** with the statements in
  [`database-setup.md`](./database-setup.md#resetting-a-development-database). Only for a database with no real
  data. Or stop the throwaway server, delete its folder and start over (section 10).

## 9. Troubleshooting

"Seen" means the message came from a run for this guide. "Derived" means it comes from the code or the packaging.
Server messages are English only if `LC_MESSAGES=C` was set before `initdb` (section 2b). Other locales translate
them, for example `FATALE: il database "nodb" non esiste`.

| Message | Cause and fix | Status |
|---|---|---|
| `initdb: command not found`, `pg_ctl: command not found` | The server programs are not in `PATH`, or only `postgresql-client-<n>` is installed. Look in `/usr/lib/postgresql/*/bin/`, put one in `PATH`, or install `postgresql-<n>`. | Seen |
| `FATAL: password authentication failed for user "x"` | Wrong password, or the role does not exist (scram does not say which). Check the URL and the role list (`\du`). | Seen |
| `fe_sendauth: no password supplied` | `PGPASSWORD` is not exported in this shell. | Seen |
| `FATAL: Peer authentication failed for user "x"` | You connected over the Unix socket of a packaged server. Add `-h 127.0.0.1`. | Derived |
| `FATAL: role "x" does not exist` | You connected without `-U`, so psql used your OS user, on a server with `trust` or `peer`. Add `-U`. | Derived |
| `FATAL: database "nodb" does not exist` | Typo, or `init.sql` was not run with that `-v db=...`. | Seen |
| `pg_ctl: could not start server`, and in `server.log`: `could not bind IPv4 address ... Address already in use`, `Is another postmaster already running on port 54331?` | Another program uses the port. `ss -ltn \| grep 54331`, then pick another port. | Seen |
| `pg_ctl: another server might be running; trying to start server anyway`, then `could not start server`; `server.log` has `FATAL: lock file "postmaster.pid" already exists` and `HINT: Is another postmaster (PID ...) running in data directory ...?` | This cluster is already running. Check with `pg_ctl -D "$C15T_PG_DIR/data" status` before you start it. Use it as it is, or stop it first (section 10). | Seen |
| `psql: error: connection to server at "127.0.0.1", port 54331 failed: Connection refused` (psql), `Error: connect ECONNREFUSED 127.0.0.1:54331` with `code: 'ECONNREFUSED'` (`yarn db:migrate`), `error: An unexpected error occurred: PgConnection: Failed to connect` (`yarn c15t:plan`, `yarn c15t:migrate`) | The server is not running, or the port in the URL is wrong. `pg_ctl -D "$C15T_PG_DIR/data" status` says `no server running`. Start it again (section 2b). | Seen |
| `Unix-domain socket path "..." is too long (maximum 107 bytes)` | Use the `unix_socket_directories=''` start of section 2b, or a short folder. | Seen |
| `ERROR: permission denied to alter role` / `Only roles with the SUPERUSER attribute may change the SUPERUSER attribute` | `init.sql` was run by a role that is not a superuser (section 3). | Seen |
| `permission denied for schema app` (or `c15t`, or `public`) | The role is not the owner of that schema. By design: `c15t_api` cannot write `app`, and nobody creates tables in `public`. For a real gap, rerun `init.sql`. | Seen |
| `permission denied for table user` / `subject` | Same boundaries: `c15t_api` cannot read the auth tables, `dashboard` cannot write consent data. | Seen |
| `permission denied to create database` | You used `c15t_api` or `dashboard` where the admin role is needed. | Seen |
| `DATABASE_URL_DASHBOARD is not set. Yarn injects it from the dev env file.` and the other messages of section 1 | The variable is missing, or you ran the tool without Yarn. Or you exported it and the file defines the same name as empty (rule 2 of section 5.1). | Seen |
| The tests ran against another database than the one you exported | The file wins (rules 1 and 5 of section 5.1). `yarn config get injectEnvironmentFiles` shows which files are read. Use `.env.test` or `YARN_INJECT_ENVIRONMENT_FILES`. | Seen |
| `command not found: vitest` | `yarn workspace @consent/consent-api test` does not work. Use `yarn vitest run --project consent-api`. | Seen |
| `relation "consent" does not exist` in `psql` | `search_path` is `"$user", public`. Write `c15t."consent"`. | Seen |
| `PgConnection: Server refused TLS`, `Client network socket disconnected before secure TLS connection was established` | `sslmode=require` against a server without TLS. Remove it from the URL. | Seen |
| `write CONNECTION_DESTROYED` | `DATABASE_URL_DASHBOARD_REPLICA` points at a server that is not a standby. Unset it. | Seen |
| `ERR_INVALID_URL`, `Must be a postgres:// or postgresql:// URL with a host` | Reserved characters in the password. Percent-encode it (section 4). | Seen / derived |
| `Error: The app or c15t schema is not migrated. Run yarn db:migrate and yarn c15t:migrate.` (dashboard-api suites), `PostgresError: relation "app.site" does not exist` (consent-api `integration.test.ts`) | The URLs point at a database that `init.sql` created but nobody migrated (section 6). | Seen |
| Two `admin-create.test.ts` tests time out at 5000 ms in the first full `yarn test` | A cold start with one parallel worker per test file (about 100). The file alone, and the next full run, passed. Rerun. | Seen once |
| `browserType.launch: Executable doesn't exist` | Run `yarn playwright install chromium`. | Derived |
| `too many connections` | The server's `max_connections` is used up. Stop other clients or raise it. | Derived |

For the production-side errors (`25006`, `57P01`, a missing grant) see the table in
[`database-setup.md`](./database-setup.md#troubleshooting).

## 10. Stop and delete

**Rootless server (2b).** Everything lives in one folder:

```bash
pg_ctl -D "$C15T_PG_DIR/data" stop -m fast
rm -rf "${C15T_PG_DIR:?}"        # the cluster, the log and the admin password. Nothing else was created.
```

**Packaged server (2a).** The cluster outlives the folder, and `rm -rf` would delete `admin.pw`, the only record of
the superuser's password. Remove what this guide put into the cluster first, as the `postgres` user and with
`yarn dev` stopped (use your cluster's port). List every database you made with `init.sql`: `DROP ROLE` stops with
`role "c15t_api" cannot be dropped because some objects depend on it` / `privileges for database <name>` while one
is left.

```bash
sudo -u postgres psql -p 5432 -v ON_ERROR_STOP=1 -d postgres <<'SQL'
DROP DATABASE IF EXISTS consent_dev;
DROP DATABASE IF EXISTS consent_test;
DROP DATABASE IF EXISTS consent_ci;
DROP ROLE c15t_api, dashboard, c15t_admin;
SQL
rm -rf "${C15T_PG_DIR:?}"
```

(Verified on the throwaway server, with a second superuser in place of `postgres`. The superuser that `initdb`
creates cannot be dropped, but that does not apply here: in 2a `c15t_admin` is an ordinary role.)

**The dotenv files.** Delete them only if you created them from this guide. An older `.env` may hold someone else's
setup. `rm -f .env .env.test` removes the two this guide makes.

A tool that connects after the stop fails. `psql` prints `connection to server at "127.0.0.1", port 54331 failed:
Connection refused`. The Node tools print `ECONNREFUSED` or `PgConnection: Failed to connect` (section 9).
