// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Logger } from './log.js';

/*
 * LISTEN on the primary (docs/decisions.md D9, CLAUDE.md "PostgreSQL"). `NOTIFY` is never delivered on a
 * replica and is lost while the listener is down, so a reconnect always ends with a full resync.
 * The driver is a seam: postgres.js's own `listen()` swallows a failed re-listen and then stays
 * silent for good, which is the one failure this listener must not have.
 */

export const SITE_CHANNEL = 'site_changed';

export interface ListenerHandlers {
  readonly onNotify: (payload: string) => void;
  /** The connection is gone. Called at most once per session. */
  readonly onClose: (reason: unknown) => void;
}

export interface ListenerSession {
  /** Rejects when the connection is dead, or no longer on a primary. */
  ping: () => Promise<void>;
  close: () => Promise<void>;
}

export interface ListenerDriver {
  /** Connects and runs `LISTEN`. Resolves once the server has confirmed it. */
  open: (handlers: ListenerHandlers) => Promise<ListenerSession>;
}

export type ListenerState = 'starting' | 'listening' | 'reconnecting' | 'stopped';

export interface ListenerOptions {
  readonly driver: ListenerDriver;
  /** A site changed. */
  readonly onChange: (siteKey: string) => void;
  /** Notifications may have been missed: forget everything. */
  readonly onResync: () => void;
  readonly logger?: Logger;
  readonly pingIntervalMs?: number;
  readonly pingTimeoutMs?: number;
  readonly backoffInitialMs?: number;
  readonly backoffMaxMs?: number;
  /** A session shorter than this does not reset the backoff, so a flapping server is not hammered. */
  readonly stableMs?: number;
  /** In [0, 1). Jitters the backoff by up to 20%. */
  readonly random?: () => number;
}
