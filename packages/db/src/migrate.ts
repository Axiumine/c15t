// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { applyMigrations, postgresExecutor } from './migrator.js';
import { createPool } from './pool.js';

// CLI entry (`yarn db:migrate`): the one place in this package that reads the environment.
const parsed = z.object({ DATABASE_URL_DASHBOARD: z.string().min(1) }).safeParse(process.env);
if (!parsed.success) {
  console.error('DATABASE_URL_DASHBOARD is not set. Yarn injects it from the dev env file.');
  process.exit(1);
}
const env = parsed.data;

const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

// A single connection, straight to the primary: migrations never use the replica.
const sql = createPool({
  url: env.DATABASE_URL_DASHBOARD,
  role: 'primary',
  applicationName: 'c15t-platform-migrate',
  max: 1,
});

try {
  const { applied } = await applyMigrations(postgresExecutor(sql), { migrationsFolder });
  console.warn(`[db] app schema is up to date (${applied} migration(s) applied)`);
} finally {
  await sql.end({ timeout: 5 });
}
