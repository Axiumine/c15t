// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { errorFields, type Logger } from './log.js';
import { type Resources, shutdown } from './server-shutdown.js';

export function handleSignals(resources: Resources, log: Logger): void {
  let shuttingDown = false;
  const stop = (reason: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('shutting down', { signal: reason });
    shutdown(resources, log).catch((error: unknown) => {
      log.error('shutdown failed', errorFields(error));
      process.exitCode = 1;
    });
  };
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => stop(signal));
  // Most often EADDRINUSE: release the pools and exit non-zero so systemd retries.
  resources.server.on('error', (error: unknown) => {
    log.error('server error', errorFields(error));
    process.exitCode = 1;
    stop('server error');
  });
}
