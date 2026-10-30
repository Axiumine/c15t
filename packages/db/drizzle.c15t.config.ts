// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { defineConfig } from 'drizzle-kit';
import { z } from 'zod';

// Used only by scripts/pull-c15t.mjs, which runs drizzle-kit from the repository root (paths below
// are relative to it). Introspection reads the `c15t` schema through the
// dashboard role, which has SELECT on it (README D2).
const env = z.object({ DATABASE_URL_DASHBOARD: z.string().min(1) }).parse(process.env);

export default defineConfig({
  dialect: 'postgresql',
  out: './packages/db/.tsbuild/c15t-pull',
  schemaFilter: ['c15t'],
  dbCredentials: { url: env.DATABASE_URL_DASHBOARD },
});
