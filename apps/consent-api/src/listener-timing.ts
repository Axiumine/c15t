// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { ListenerOptions } from './listener-types.js';

const DEFAULT_BACKOFF_INITIAL_MS = 500;
const DEFAULT_BACKOFF_MAX_MS = 30_000;

/** Exponential backoff after `failures` failed attempts, jittered by up to 20%. */
export function backoffDelay(options: ListenerOptions, failures: number): number {
  const initial = options.backoffInitialMs ?? DEFAULT_BACKOFF_INITIAL_MS;
  const max = options.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS;
  const jitter = 1 + ((options.random ?? Math.random)() - 0.5) * 0.4;
  return Math.round(Math.min(max, initial * 2 ** failures) * jitter);
}

/** Resolves after `ms`, or as soon as `signal` aborts. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
