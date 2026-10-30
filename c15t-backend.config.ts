// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { type C15TOptions, defineConfig } from '@c15t/backend';

// Used only by the migration CLI (`yarn c15t:plan` / `yarn c15t:migrate`). consent-api builds
// one instance per site at runtime. Migrations always run against the primary (README D9), and
// the schema must match the one consent-api uses (CLAUDE.md "c15t gotchas").
const url = process.env['DATABASE_URL_C15T'];
if (url === undefined || url === '') {
  throw new Error('DATABASE_URL_C15T is not set');
}

// The annotation keeps declaration emit portable (the config type itself is not exported).
const config: C15TOptions = defineConfig({
  database: { dialect: 'postgres', url, schema: 'c15t' },
});

export default config;
