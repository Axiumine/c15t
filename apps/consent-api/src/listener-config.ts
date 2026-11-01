// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type postgres from 'postgres';
import type { ListenerHandlers } from './listener-types.js';

export interface PostgresListenerOptions {
  /** `DATABASE_URL_C15T`: the primary. */
  readonly url: string;
  readonly channel?: string;
  readonly connectTimeoutSeconds?: number;
  readonly keepAliveSeconds?: number;
}

/** Whether the session is over, so the listener hears about it once. */
export interface Latch {
  closed: boolean;
}

// `onnotify` is the hook postgres.js's own listen() installs. It is missing from the public
// types, and the exact version is pinned.
type ListenConfig = postgres.Options<Record<string, postgres.PostgresType>> & {
  onnotify: (name: string, payload: string) => void;
};

export function listenConfig(
  options: PostgresListenerOptions,
  channel: string,
  handlers: ListenerHandlers,
  latch: Latch,
): ListenConfig {
  return {
    max: 1,
    max_lifetime: null,
    connect_timeout: options.connectTimeoutSeconds ?? 5,
    keep_alive: options.keepAliveSeconds ?? 30,
    target_session_attrs: 'read-write',
    fetch_types: false,
    connection: { application_name: 'consent-api-listener' },
    onnotice: () => undefined,
    onnotify: (name, payload) => {
      if (name === channel) handlers.onNotify(payload);
    },
    onclose: () => {
      if (latch.closed) return;
      latch.closed = true;
      handlers.onClose(new Error('The listener connection closed'));
    },
  };
}
