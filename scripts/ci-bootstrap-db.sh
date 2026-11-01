#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Axiumine
#
# CI only. Prepares an EMPTY PostgreSQL server for the real-database test suites:
#   1. runs infra/postgres/init.sql (roles c15t_api and dashboard, the database, the schemas
#      c15t and app, grants) with freshly generated role passwords,
#   2. applies the c15t migrations as c15t_api (yarn c15t:migrate),
#   3. applies the app migrations as dashboard (yarn db:migrate),
#   4. asserts the roles, schema ownership and grants that docs/database-setup.md section 4 checks,
#   5. writes the variables the suites read to $GITHUB_ENV, masking every secret first.
#
# It never targets a shared database: point it at a throwaway server only. Re-running it on the
# same server is safe (init.sql is idempotent, and the role passwords are reset to the new ones).
#
# Input (libpq environment variables, for a superuser: CREATEROLE and CREATEDB are not enough on
# PostgreSQL 16 and newer, because init.sql runs ALTER ROLE ... NOSUPERUSER):
#   PGPASSWORD   required
#   PGHOST       default 127.0.0.1
#   PGPORT       default 5432
#   PGUSER       default postgres
#   CI_DB_NAME   default consent_ci (the database init.sql creates)
#   C15T_API_PW, DASHBOARD_PW   optional; 32+ lowercase hex characters. Generated when unset.
#   C15T_ADMIN_API_KEY          optional; generated when unset.
#
# Output, appended to $GITHUB_ENV (required) so that later steps see it:
#   DATABASE_URL_C15T, DATABASE_URL_DASHBOARD   (consent-api integration tests, dashboard-api
#                                                suites on the real database, c15t CLI)
#   C15T_ADMIN_API_KEY                          (consent-api integration tests)
set -euo pipefail

log() { printf '[ci-bootstrap-db] %s\n' "$*"; }
die() { printf '[ci-bootstrap-db] error: %s\n' "$*" >&2; exit 1; }

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root"

[[ -n "${PGPASSWORD:-}" ]] || die 'PGPASSWORD (the administrator password) is not set'
[[ -n "${GITHUB_ENV:-}" ]] || die 'GITHUB_ENV is not set; refusing to print secrets (run this inside GitHub Actions)'
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}" PGDATABASE=postgres
db_name="${CI_DB_NAME:-consent_ci}"
[[ "$db_name" =~ ^[a-z][a-z0-9_]{0,40}$ ]] || die 'CI_DB_NAME must match ^[a-z][a-z0-9_]{0,40}$'

# psql comes from the runner image (ubuntu-24.04 ships the PostgreSQL 16 client tools), so there
# is no apt-get here and nothing unpinned to install.
if command -v psql > /dev/null 2>&1; then
  psql_bin=$(command -v psql)
else
  psql_bin=$(find /usr/lib/postgresql -path '*/bin/psql' 2> /dev/null | sort -V | tail -n 1 || true)
fi
[[ -x "${psql_bin:-}" ]] || die 'psql not found on this runner'

# Secrets: generated here, masked before they can reach a log line.
secret() { openssl rand -hex "$1"; }
c15t_pw="${C15T_API_PW:-$(secret 24)}"
dash_pw="${DASHBOARD_PW:-$(secret 24)}"
api_key="${C15T_ADMIN_API_KEY:-$(secret 32)}"
for value in "$c15t_pw" "$dash_pw"; do
  # Hex only: it is interpolated into psql \set commands and into URLs without escaping.
  [[ "$value" =~ ^[0-9a-f]{32,}$ ]] || die 'role passwords must be 32+ lowercase hex characters'
done
[[ -n "$api_key" ]] || die 'C15T_ADMIN_API_KEY is empty'
if [[ "${GITHUB_ACTIONS:-}" == 'true' ]]; then
  for value in "$PGPASSWORD" "$c15t_pw" "$dash_pw" "$api_key"; do
    printf '::add-mask::%s\n' "$value"
  done
fi

log "waiting for PostgreSQL at ${PGHOST}:${PGPORT}"
for attempt in $(seq 1 30); do
  if "$psql_bin" -X -q -t -A -c 'select 1' > /dev/null 2>&1; then break; fi
  [[ "$attempt" -lt 30 ]] || die 'PostgreSQL did not accept connections within 60 s'
  sleep 2
done

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# init.sql takes its parameters as psql variables. They are written to a private file instead of
# -v arguments so the passwords never appear in a process list.
{
  printf '\\set c15t_pw %s\n' "'${c15t_pw}'"
  printf '\\set dash_pw %s\n' "'${dash_pw}'"
  printf '\\set db %s\n' "${db_name}"
  cat infra/postgres/init.sql
  # init.sql leaves existing roles alone; reset the passwords so a re-run stays consistent.
  # These are cluster-wide statements, so it does not matter which database the script is in.
  printf '%s\n' "ALTER ROLE c15t_api PASSWORD :'c15t_pw';"
  printf '%s\n' "ALTER ROLE dashboard PASSWORD :'dash_pw';"
} > "$work/bootstrap.sql"
chmod 600 "$work/bootstrap.sql"

log 'running infra/postgres/init.sql'
"$psql_bin" -X -q -v ON_ERROR_STOP=1 -f "$work/bootstrap.sql"

url() { printf 'postgresql://%s:%s@%s:%s/%s' "$1" "$2" "$PGHOST" "$PGPORT" "$db_name"; }
c15t_url=$(url c15t_api "$c15t_pw")
dashboard_url=$(url dashboard "$dash_pw")

# Same order as infra/deploy.sh: c15t first (it owns schema c15t), then the app schema. Each
# command gets only its own URL, as in production.
log 'yarn c15t:migrate (role c15t_api)'
DATABASE_URL_C15T="$c15t_url" yarn c15t:migrate --yes
log 'yarn db:migrate (role dashboard)'
DATABASE_URL_DASHBOARD="$dashboard_url" yarn db:migrate

# The verification queries of docs/database-setup.md section 4, as one assertion: role
# attributes, schema ownership, and the grants the two roles must (not) have. Run as the admin,
# in the new database.
log 'verifying roles, schema ownership and grants (docs/database-setup.md, section 4)'
verified=$(PGDATABASE="$db_name" "$psql_bin" -X -q -t -A -v ON_ERROR_STOP=1 -c "
  select
    not exists (select 1 from pg_roles
                where rolname in ('c15t_api', 'dashboard') and (rolsuper or rolcreatedb or rolcreaterole))
    and (select pg_get_userbyid(nspowner) from pg_namespace where nspname = 'c15t') = 'c15t_api'
    and (select pg_get_userbyid(nspowner) from pg_namespace where nspname = 'app') = 'dashboard'
    and has_table_privilege('dashboard', 'c15t.\"consentPolicy\"', 'SELECT')
    and not has_table_privilege('dashboard', 'c15t.\"consentPolicy\"', 'INSERT')
    and has_table_privilege('c15t_api', 'app.site', 'SELECT')
    and not has_table_privilege('c15t_api', 'app.site', 'UPDATE')
    and not has_table_privilege('c15t_api', 'app.\"user\"', 'SELECT')")
[[ "$verified" == 't' ]] || die 'role, ownership or grant check failed: the setup differs from docs/database-setup.md'

{
  printf 'DATABASE_URL_C15T=%s\n' "$c15t_url"
  printf 'DATABASE_URL_DASHBOARD=%s\n' "$dashboard_url"
  printf 'C15T_ADMIN_API_KEY=%s\n' "$api_key"
} >> "$GITHUB_ENV"
log "done: database ${db_name} is ready; test variables exported to GITHUB_ENV"
