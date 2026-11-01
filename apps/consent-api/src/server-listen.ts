// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { serve } from '@hono/node-server';
import type { createApp } from './app.js';
import type { Env } from './env.js';
import type { Logger } from './log.js';

// nginx keeps upstream connections for 60 s by default: close idle ones after that, not before.
const KEEP_ALIVE_TIMEOUT_MS = 75_000;
const HEADERS_TIMEOUT_MS = 80_000;
const REQUEST_TIMEOUT_MS = 30_000;

export type Server = ReturnType<typeof serve>;

export function listen(app: ReturnType<typeof createApp>, env: Env, log: Logger): Server {
  const server = serve(
    { fetch: app.fetch, hostname: env.CONSENT_API_HOST, port: env.CONSENT_API_PORT },
    (info) => {
      log.info('consent-api listening', { host: info.address, port: info.port });
    },
  );
  if ('keepAliveTimeout' in server) {
    server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
    server.headersTimeout = HEADERS_TIMEOUT_MS;
    server.requestTimeout = REQUEST_TIMEOUT_MS;
  }
  return server;
}
