// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import react from '@vitejs/plugin-react';
import { defineProject } from 'vitest/config';

// The 'source' export condition lets tests import sibling packages from src/ without a build.
export default defineProject({
  plugins: [react()],
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'], externalConditions: ['source'] } },
  test: {
    name: 'dashboard-web',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    css: false,
    clearMocks: true,
    unstubGlobals: true,
  },
});
