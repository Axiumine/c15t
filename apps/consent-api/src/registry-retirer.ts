// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { errorFields, type Logger } from './log.js';
import type { Entry } from './registry-types.js';

/**
 * An instance that is retired (site changed, listener reconnected, database error) is not
 * disposed under a request that still uses it: disposal waits for the in-flight requests, and
 * happens in any case after `drainMs`.
 */
export class EntryRetirer {
  private readonly log: Logger;
  private readonly drainMs: number;
  private readonly retiring = new Set<Entry>();
  private readonly disposals = new Set<Promise<void>>();

  constructor(log: Logger, drainMs: number) {
    this.log = log;
    this.drainMs = drainMs;
  }

  /** Called once per entry: every caller takes it out of the live entries first. */
  retire(entry: Entry): void {
    entry.retired = true;
    this.retiring.add(entry);
    // The next macrotask, not now: a request that has just been handed this entry has not
    // counted itself in yet.
    setTimeout(() => {
      if (entry.inflight === 0) this.dispose(entry);
    }, 0).unref();
    entry.hardTimer = setTimeout(() => this.dispose(entry), this.drainMs);
    entry.hardTimer.unref();
  }

  release(entry: Entry): void {
    entry.inflight -= 1;
    if (entry.retired && entry.inflight === 0) this.dispose(entry);
  }

  /** Disposes every retired instance and waits for the pools to close. */
  async disposeAll(): Promise<void> {
    for (const entry of [...this.retiring]) this.dispose(entry);
    await Promise.allSettled([...this.disposals]);
  }

  private dispose(entry: Entry): void {
    if (entry.disposed) return;
    entry.disposed = true;
    this.retiring.delete(entry);
    clearTimeout(entry.hardTimer);
    const done: Promise<void> = Promise.resolve()
      .then(() => entry.instance.dispose())
      .catch((error: unknown) => {
        this.log.warn('disposing a c15t instance failed', {
          siteKey: entry.record.key,
          ...errorFields(error),
        });
      })
      .then(() => {
        this.disposals.delete(done);
      });
    this.disposals.add(done);
  }
}
