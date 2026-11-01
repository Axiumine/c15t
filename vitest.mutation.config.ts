// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { defineConfig } from 'vitest/config';

/*
 * The test selection that StrykerJS runs for mutation testing (stryker.config.mjs, docs/quality-gates.md).
 * One flat project instead of the root `projects` list, so the selection is explicit:
 *
 * - Node packages only. dashboard-web (jsdom, React) is out of the mutation scope.
 * - No real-database suite. The integration test of consent-api needs the dev database and fails
 *   loudly without it. The dashboard-api suites run on PGlite only, because stryker.config.mjs sets
 *   `C15T_TEST_ENVIRONMENTS=pglite` and removes the database variables from the process environment.
 */
export default defineConfig({
  // The 'source' export condition lets tests import sibling packages from src/ without a build.
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'], externalConditions: ['source'] } },
  test: {
    name: 'mutation',
    environment: 'node',
    include: [
      'packages/shared/src/**/*.test.ts',
      'packages/db/src/**/*.test.ts',
      'apps/consent-api/src/**/*.test.ts',
      'apps/dashboard-api/src/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'apps/consent-api/src/integration.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
