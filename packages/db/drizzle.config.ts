// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { defineConfig } from 'drizzle-kit';

// `generate` needs no database. Migrations run through src/migrate.ts, not `drizzle-kit migrate`,
// so the credentials stay out of this file. The journal table lives in `app` because the
// `dashboard` role cannot create the default `drizzle` schema.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  schemaFilter: ['app'],
  migrations: { schema: 'app', table: '__drizzle_migrations' },
});
