// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { defineProject } from 'vitest/config';

// The 'source' export condition lets tests import sibling packages from src/ without a build.
export default defineProject({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'], externalConditions: ['source'] } },
  test: { name: 'db', environment: 'node', include: ['src/**/*.test.ts'] },
});
