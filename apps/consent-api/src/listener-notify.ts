// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { SITE_KEY_PATTERN } from '@consent/shared';
import type { ListenerOptions } from './listener-types.js';
import { errorFields, type Logger } from './log.js';

export interface Notifier {
  /** A payload arrived on the site channel. */
  readonly notified: (payload: string) => void;
  /** Notifications may have been missed: forget everything. */
  readonly resync: () => void;
}

function safely(log: Logger, what: string, work: () => void): void {
  try {
    work();
  } catch (error) {
    log.error(`site listener ${what} handler failed`, errorFields(error));
  }
}

/** Turns the payloads of the site channel into `onChange` and `onResync` calls that never throw. */
export function createNotifier(options: ListenerOptions, log: Logger): Notifier {
  const resync = (): void => safely(log, 'resync', () => options.onResync());
  const notified = (payload: string): void => {
    if (SITE_KEY_PATTERN.test(payload)) {
      safely(log, 'change', () => options.onChange(payload));
      return;
    }
    // Not a key we know how to scope: stay safe and forget everything.
    log.warn('unexpected payload on the site channel, resyncing');
    resync();
  };
  return { notified, resync };
}
