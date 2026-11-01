// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { ListenerOptions, ListenerSession } from './listener-types.js';

const DEFAULT_PING_INTERVAL_MS = 15_000;
const DEFAULT_PING_TIMEOUT_MS = 5_000;

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Pings the session until it is lost, or `signal` aborts. Resolves with the reason it is over. */
export function watchSession(
  session: ListenerSession,
  lost: Promise<unknown>,
  signal: AbortSignal,
  options: ListenerOptions,
): Promise<unknown> {
  const pingEvery = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
  const pingTimeout = options.pingTimeoutMs ?? DEFAULT_PING_TIMEOUT_MS;
  return new Promise<unknown>((resolve) => {
    let pinging = false;
    const finish = (reason: unknown): void => {
      clearInterval(timer);
      resolve(reason);
    };
    const timer = setInterval(() => {
      if (pinging) return;
      pinging = true;
      withTimeout(session.ping(), pingTimeout)
        .catch(finish)
        .finally(() => {
          pinging = false;
        });
    }, pingEvery);
    void lost.then(finish);
    signal.addEventListener('abort', () => finish('stopped'), { once: true });
  });
}
