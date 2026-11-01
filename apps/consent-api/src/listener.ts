// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { createNotifier, type Notifier } from './listener-notify.js';
import { backoffDelay, sleep } from './listener-timing.js';
import {
  type ListenerOptions,
  type ListenerSession,
  type ListenerState,
  SITE_CHANNEL,
} from './listener-types.js';
import { watchSession } from './listener-watch.js';
import { errorFields, type Logger, silentLogger } from './log.js';

const DEFAULT_STABLE_MS = 10_000;

/**
 * Keeps one `LISTEN site_changed` session alive. A lost session (close, failed ping, ping that
 * finds a standby) is followed by a reconnect with exponential backoff, and, once `LISTEN` is
 * confirmed again, by `onResync`. The first session also resyncs: it costs nothing and covers
 * changes made before the service started listening.
 */
export class SiteChangeListener {
  private readonly options: ListenerOptions;
  private readonly log: Logger;
  private readonly notifier: Notifier;
  private readonly abort = new AbortController();
  private loop: Promise<void> | undefined;
  private current: ListenerState = 'starting';

  constructor(options: ListenerOptions) {
    this.options = options;
    this.log = options.logger ?? silentLogger;
    this.notifier = createNotifier(options, this.log);
  }

  get state(): ListenerState {
    return this.current;
  }

  start(): void {
    this.loop ??= this.run();
  }

  async stop(): Promise<void> {
    this.abort.abort();
    await this.loop;
    this.current = 'stopped';
  }

  /** A method, not a getter: TypeScript would keep a narrowed `this.stopped` across an await. */
  private isStopped(): boolean {
    return this.abort.signal.aborted;
  }

  private async run(): Promise<void> {
    let failures = 0;
    while (!this.isStopped()) {
      const listenedMs = await this.runSession();
      if (this.isStopped()) break;
      if (listenedMs !== undefined && listenedMs >= (this.options.stableMs ?? DEFAULT_STABLE_MS)) {
        failures = 0;
      }
      this.current = 'reconnecting';
      await sleep(backoffDelay(this.options, failures), this.abort.signal);
      failures += 1;
    }
  }

  /** One connection, from `open` until it is lost. Returns how long it listened, if it ever did. */
  private async runSession(): Promise<number | undefined> {
    let session: ListenerSession | undefined;
    try {
      const lost = Promise.withResolvers<unknown>();
      session = await this.options.driver.open({
        onNotify: (payload) => this.notifier.notified(payload),
        onClose: (reason) => lost.resolve(reason),
      });
      if (this.isStopped()) return undefined;
      const startedAt = Date.now();
      this.current = 'listening';
      this.log.info('listening for site changes', { channel: SITE_CHANNEL });
      this.notifier.resync();
      const reason = await watchSession(session, lost.promise, this.abort.signal, this.options);
      if (!this.isStopped()) this.log.warn('site listener lost', errorFields(reason));
      return Date.now() - startedAt;
    } catch (error) {
      this.log.warn('site listener could not connect', errorFields(error));
      return undefined;
    } finally {
      await session?.close().catch(() => undefined);
    }
  }
}
