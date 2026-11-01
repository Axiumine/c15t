// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

/*
 * StrykerJS mutation testing: `yarn mutation`. Weekly in CI (.github/workflows/mutation.yml), never a
 * pull-request check. What it measures, how to read it and the measured scores: docs/quality-gates.md.
 */

/*
 * NO DATABASE. The mutation suites must never touch the shared development database or any real
 * server, and a stray Yarn env-file injection (`yarn mutation` injects the dev database variables
 * when the file exists) must not change that. This file runs in the main Stryker process before
 * any test runner is forked, so the changes below reach every worker:
 *
 * - the database variables and the admin key are removed;
 * - `C15T_TEST_ENVIRONMENTS=pglite` makes the dashboard-api suites skip their real-database
 *   variants, so they run on PGlite (Postgres compiled to WebAssembly, in process) only.
 */
for (const name of [
  'DATABASE_URL_C15T',
  'DATABASE_URL_DASHBOARD',
  'DATABASE_URL_DASHBOARD_REPLICA',
  'C15T_ADMIN_API_KEY',
]) {
  // eslint-disable-next-line security/detect-object-injection -- name comes from the literal list above
  delete process.env[name];
}
process.env['C15T_TEST_ENVIRONMENTS'] = 'pglite';

export default {
  testRunner: 'vitest',
  plugins: ['@stryker-mutator/vitest-runner', '@stryker-mutator/typescript-checker'],
  vitest: { configFile: 'vitest.mutation.config.ts' },

  // A mutant that does not type-check is discarded instead of being run (and "killed" by a crash).
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.mutation.json',

  // Run only the tests that executed the mutated line.
  coverageAnalysis: 'perTest',

  // The scope was picked by measurement (docs/quality-gates.md, "Mutation testing"): the code whose
  // wrong behaviour is a security or data-correctness bug and whose tests run without a browser or a
  // real server. dashboard-api wiring (routes, Better Auth setup, env, server) is left out because it
  // costs most of the run time (every mutant re-creates a PGlite database) and is covered end to end by
  // the Playwright suite instead. Widen it on the command line: `yarn mutation --mutate 'glob,glob'`.
  mutate: [
    'packages/shared/src/**/*.ts',
    'packages/db/src/{client,failover,migrate,migrator,pool}.ts',
    'apps/consent-api/src/**/*.ts',
    'apps/dashboard-api/src/{audit,audit-actor,audit-cursor,audit-list,authz,authz-types,session,site-access}.ts',
    'apps/dashboard-api/src/{c15t-read,consent-*}.ts',
    'apps/dashboard-api/src/{csv,errors,error-handler,error-response,pagination,password,range}.ts',
    'apps/dashboard-api/src/{site-mapping,users,validate}.ts',
    '!**/*.test.ts',
    '!**/testing/**',
  ],

  // `yarn mutation` passes --incremental: results of unchanged mutants and tests are reused from this
  // file, which CI keeps in a cache. It lives under reports/, which is git-ignored.
  incrementalFile: 'reports/mutation/stryker-incremental.json',
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/mutation.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  clearTextReporter: { reportTests: false, reportMutants: false, reportScoreTable: true },
  tempDirName: '.stryker-tmp',
  cleanTempDir: true,

  timeoutMS: 20_000,

  // `break` fails the run (exit code 1) when the score is below it. Measured on a cold run (no
  // incremental file, no database) on 32 cores: 94.09% (1592 of 1692 valid mutants detected, 100
  // survived, 928 that did not compile discarded; consent-api alone 90.12%), so `break` is the score
  // minus a margin of about 4 points. The margin covers a refactor that adds a few mutants the tests
  // do not see, the unseeded fast-check tests and the time-out kills that move the score by about a
  // point between runs; a deleted test file or an untested new module falls far below it. Raise it
  // when the score rises, never lower it to make a run pass. docs/quality-gates.md.
  thresholds: { high: 95, low: 90, break: 90 },
};
