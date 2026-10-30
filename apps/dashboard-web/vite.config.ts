// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/*
 * The only place that reads the environment or names an address (CLAUDE.md "Network
 * configuration"). The API defaults are copied from apps/dashboard-api/src/env.ts, not imported:
 * dashboard-web never pulls in server code. Nothing here ships to the browser.
 */
const API_HOST = process.env['DASHBOARD_API_HOST']?.trim() || '127.0.0.1';
const API_PORT = process.env['DASHBOARD_API_PORT']?.trim() || '4200';
const DEV_HOST = '127.0.0.1';
const DEV_PORT = Number(process.env['DASHBOARD_WEB_DEV_PORT']?.trim() || '5173');

const apiTarget = `http://${API_HOST.includes(':') ? `[${API_HOST}]` : API_HOST}:${API_PORT}`;

// Same origin in dev as in production: the browser only ever talks to this server, and /api is
// proxied unchanged (Host and Origin stay as the browser sent them, which Better Auth checks).
const server = {
  host: DEV_HOST,
  port: DEV_PORT,
  strictPort: true,
  proxy: { '/api': { target: apiTarget, changeOrigin: false } },
};

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  // Bundle the workspace packages from source, so a build needs no prebuilt dist/.
  resolve: { conditions: ['source'] },
  server,
  preview: server,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    // The license text of every bundled dependency, next to the minified bundle: the bundle
    // carries no notices of its own. release-package.sh refuses to pack without this file.
    license: { fileName: 'THIRD-PARTY-NOTICES.md' },
    // main.tsx configures zod before @consent/shared builds its schemas; without this the
    // chunk graph may run the shared chunk first and zod probes `new Function` (CSP violation).
    rolldownOptions: { output: { strictExecutionOrder: true } },
  },
});
