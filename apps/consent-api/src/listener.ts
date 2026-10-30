// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { SITE_KEY_PATTERN } from '@consent/shared';
import postgres from 'postgres';
import { errorFields, type Logger, silentLogger } from './log.js';

/*
 * LISTEN on the primary (README D9, CLAUDE.md "PostgreSQL"). `NOTIFY` is never delivered on a
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

const DEFAULT_PING_INTERVAL_MS = 15_000;
const DEFAULT_PING_TIMEOUT_MS = 5_000;
const DEFAULT_BACKOFF_INITIAL_MS = 500;
const DEFAULT_BACKOFF_MAX_MS = 30_000;
const DEFAULT_STABLE_MS = 10_000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Keeps one `LISTEN site_changed` session alive. A lost session (close, failed ping, ping that
 * finds a standby) is followed by a reconnect with exponential backoff, and, once `LISTEN` is
 * confirmed again, by `onResync`. The first session also resyncs: it costs nothing and covers
 * changes made before the service started listening.
 */
export class SiteChangeListener {
  private readonly options: ListenerOptions;
  private readonly log: Logger;
  private readonly abort = new AbortController();
  private loop: Promise<void> | undefined;
  private current: ListenerState = 'starting';

  constructor(options: ListenerOptions) {
    this.options = options;
    this.log = options.logger ?? silentLogger;
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

  private get stopped(): boolean {
    return this.abort.signal.aborted;
  }

  private async run(): Promise<void> {
    let failures = 0;
    while (!this.stopped) {
      const listenedMs = await this.runSession();
      if (this.stopped) break;
      if (listenedMs !== undefined && listenedMs >= (this.options.stableMs ?? DEFAULT_STABLE_MS)) {
        failures = 0;
      }
      this.current = 'reconnecting';
      await this.sleep(this.backoff(failures));
      failures += 1;
    }
  }

  /** One connection, from `open` until it is lost. Returns how long it listened, if it ever did. */
  private async runSession(): Promise<number | undefined> {
    let session: ListenerSession | undefined;
    try {
      let lose: (reason: unknown) => void = () => {};
      const lost = new Promise<unknown>((resolve) => {
        lose = resolve;
      });
      session = await this.options.driver.open({
        onNotify: (payload) => this.notified(payload),
        onClose: (reason) => lose(reason),
      });
      if (this.stopped) return undefined;
      const startedAt = Date.now();
      this.current = 'listening';
      this.log.info('listening for site changes', { channel: SITE_CHANNEL });
      this.safely('resync', () => this.options.onResync());
      const reason = await this.watch(session, lost);
      if (!this.stopped) this.log.warn('site listener lost', errorFields(reason));
      return Date.now() - startedAt;
    } catch (error) {
      this.log.warn('site listener could not connect', errorFields(error));
      return undefined;
    } finally {
      await session?.close().catch(() => undefined);
    }
  }

  /** Resolves with the reason the session is over. */
  private watch(session: ListenerSession, lost: Promise<unknown>): Promise<unknown> {
    const pingEvery = this.options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS;
    const pingTimeout = this.options.pingTimeoutMs ?? DEFAULT_PING_TIMEOUT_MS;
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
      lost.then(finish);
      this.abort.signal.addEventListener('abort', () => finish('stopped'), { once: true });
    });
  }

  private backoff(failures: number): number {
    const initial = this.options.backoffInitialMs ?? DEFAULT_BACKOFF_INITIAL_MS;
    const max = this.options.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS;
    const jitter = 1 + ((this.options.random ?? Math.random)() - 0.5) * 0.4;
    return Math.round(Math.min(max, initial * 2 ** failures) * jitter);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.abort.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  private notified(payload: string): void {
    if (SITE_KEY_PATTERN.test(payload)) {
      this.safely('change', () => this.options.onChange(payload));
      return;
    }
    // Not a key we know how to scope: stay safe and forget everything.
    this.log.warn('unexpected payload on the site channel, resyncing');
    this.safely('resync', () => this.options.onResync());
  }

  private safely(what: string, work: () => void): void {
    try {
      work();
    } catch (error) {
      this.log.error(`site listener ${what} handler failed`, errorFields(error));
    }
  }
}

export interface PostgresListenerOptions {
  /** `DATABASE_URL_C15T`: the primary. */
  readonly url: string;
  readonly channel?: string;
  readonly connectTimeoutSeconds?: number;
  readonly keepAliveSeconds?: number;
}

/**
 * One dedicated postgres.js connection that has issued `LISTEN`. It must never reconnect on its
 * own: a fresh connection has no `LISTEN`. So a close ends the session (`onClose`) and the
 * listener opens a new one. `target_session_attrs` keeps it off a standby, TCP keepalive finds a
 * dead peer, and `ping` catches a node that was demoted without dropping the connection.
 */
export function createPostgresListenerDriver(options: PostgresListenerOptions): ListenerDriver {
  const channel = options.channel ?? SITE_CHANNEL;
  return {
    async open(handlers) {
      let closed = false;
      const end = (reason: unknown): void => {
        if (closed) return;
        closed = true;
        handlers.onClose(reason);
      };
      // `onnotify` is the hook postgres.js's own listen() installs. It is missing from the public
      // types, and the exact version is pinned.
      const config: postgres.Options<Record<string, postgres.PostgresType>> & {
        onnotify: (name: string, payload: string) => void;
      } = {
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
        onclose: () => end(new Error('The listener connection closed')),
      };
      const sql = postgres(options.url, config);
      try {
        await sql.unsafe(`listen "${channel.replace(/"/g, '""')}"`);
      } catch (error) {
        closed = true;
        await sql.end({ timeout: 0 }).catch(() => undefined);
        throw error;
      }
      return {
        async ping() {
          const rows = await sql`select pg_is_in_recovery() as in_recovery`;
          if (rows[0]?.['in_recovery'] !== false) {
            throw new Error('The listener is connected to a standby');
          }
        },
        async close() {
          closed = true;
          await sql.end({ timeout: 2 });
        },
      };
    },
  };
}
