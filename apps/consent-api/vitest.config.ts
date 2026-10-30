// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { defineProject } from 'vitest/config';

// The 'source' export condition lets tests import sibling packages from src/ without a build.
export default defineProject({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'], externalConditions: ['source'] } },
  test: {
    name: 'consent-api',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The integration test waits for NOTIFY and for pools; the rest finishes in milliseconds.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
