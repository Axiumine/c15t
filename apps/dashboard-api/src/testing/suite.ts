// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { afterAll, beforeAll, describe, test } from 'vitest';
import { createEnvironment, type EnvironmentKind, type TestEnvironment } from './environment.js';

/** The same tests run on PGlite and, with the dev database variables set, on the real database. */
export const ENVIRONMENT_KINDS: readonly EnvironmentKind[] = ['pglite', 'postgres'];

export interface SuiteContext {
  readonly kind: EnvironmentKind;
  /** Throws the setup error when the environment could not be created, so every test fails loudly. */
  env(): TestEnvironment;
}

export function describeEnvironments(
  name: string,
  define: (context: SuiteContext) => void,
  kinds: readonly EnvironmentKind[] = ENVIRONMENT_KINDS,
): void {
  describe.each(kinds)(`${name} (%s)`, (kind) => {
    let environment: TestEnvironment | undefined;
    let setupError: unknown;

    beforeAll(async () => {
      try {
        environment = await createEnvironment(kind);
      } catch (error) {
        // Reported by the test below and by every test that touches `env()`; never a silent skip.
        setupError = error;
      }
    }, 120_000);

    // A sibling suite, so a failing hook in the tests below cannot hide this failure as a skip.
    describe('environment', () => {
      test('the database is reachable and migrated', () => {
        if (setupError !== undefined) throw setupError;
        if (environment === undefined) throw new Error('test environment is not ready');
      });
    });

    afterAll(async () => {
      if (environment === undefined) return;
      try {
        await environment.cleanup();
      } finally {
        await environment.close();
      }
    }, 60_000);

    describe('behavior', () => {
      define({
        kind,
        env: () => {
          if (environment === undefined) {
            throw setupError instanceof Error
              ? setupError
              : new Error('test environment is not ready');
          }
          return environment;
        },
      });
    });
  });
}
