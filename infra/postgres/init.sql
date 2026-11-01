-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Copyright (C) 2026 Axiumine

-- One-time, idempotent bootstrap of roles, database, schemas and grants (README D2, D9).
-- Run as a SUPERUSER, once, on the Patroni PRIMARY. On PostgreSQL 16 and newer a role with only
-- CREATEROLE and CREATEDB is not enough: it stops at the first ALTER ROLE below with "permission
-- denied to alter role". Everything replicates to the other nodes. Safe to rerun: nothing is
-- dropped, and existing roles keep their passwords (rotate with ALTER ROLE).
--
--   export C15T_API_PW=$(openssl rand -hex 24)
--   export DASHBOARD_PW=$(openssl rand -hex 24)
--   psql -v ON_ERROR_STOP=1 -v c15t_pw="$C15T_API_PW" -v dash_pw="$DASHBOARD_PW" \
--        -v db=consent_dev -d postgres -f infra/postgres/init.sql
--
-- Put the passwords into DATABASE_URL_C15T / DATABASE_URL_DASHBOARD (see env.example). pg_hba
-- entries for both roles go through Patroni's config (postgresql.pg_hba in the DCS), never into
-- a node's pg_hba.conf.
--
-- Ownership: role c15t_api owns schema `c15t` (created and migrated only by
-- `yarn c15t:migrate`). Role dashboard owns schema `app` (`yarn db:migrate`).

\if :{?db}
\else
  \set db consent_dev
\endif

-- Roles. \gexec runs the generated statement only when the role is missing.
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'c15t_api', :'c15t_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'c15t_api')
\gexec

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', 'dashboard', :'dash_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard')
\gexec

-- Neither role may create databases or roles.
ALTER ROLE c15t_api  NOSUPERUSER NOCREATEDB NOCREATEROLE;
ALTER ROLE dashboard NOSUPERUSER NOCREATEDB NOCREATEROLE;

-- Optional connection budget (the primary shares max_connections with other databases):
-- ALTER ROLE c15t_api  CONNECTION LIMIT 30;
-- ALTER ROLE dashboard CONNECTION LIMIT 15;

-- Database.
SELECT format('CREATE DATABASE %I', :'db')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db')
\gexec

REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT ON DATABASE :"db" TO c15t_api, dashboard;

\connect :"db"

-- Nothing for the platform lives in `public`.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Schemas. `app` is created here, not by the drizzle migration, because the dashboard role has
-- no CREATE privilege on the database.
CREATE SCHEMA IF NOT EXISTS c15t AUTHORIZATION c15t_api;
CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION dashboard;

-- dashboard: read-only on c15t.* (README D2, D4). dashboard-api never writes to consent data.
GRANT USAGE ON SCHEMA c15t TO dashboard;
-- Tables that c15t creates later, owned by c15t_api:
ALTER DEFAULT PRIVILEGES FOR ROLE c15t_api IN SCHEMA c15t GRANT SELECT ON TABLES TO dashboard;
-- Tables that already exist. If `yarn c15t:migrate` ran before the default privileges above
-- were in place, run just this statement as c15t_api (it owns the tables) or as an admin:
GRANT SELECT ON ALL TABLES IN SCHEMA c15t TO dashboard;

-- c15t_api: reads the site registry. USAGE here; SELECT on app.site is granted by drizzle
-- migration 0001_guards, once the table exists. c15t_api never sees the auth tables.
GRANT USAGE ON SCHEMA app TO c15t_api;
