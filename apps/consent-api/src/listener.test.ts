// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { afterEach, describe, expect, test, vi } from 'vitest';
import { SiteChangeListener } from './listener.js';
import type { ListenerDriver, ListenerHandlers, ListenerSession } from './listener-types.js';
import { capturingLogger, deferred } from './testing/fakes.js';

class FakeSession implements ListenerSession {
  closed = 0;
  ping: () => Promise<void> = async () => {};
  readonly handlers: ListenerHandlers;

  constructor(handlers: ListenerHandlers) {
    this.handlers = handlers;
  }

  async close(): Promise<void> {
    this.closed += 1;
  }
}

class FakeDriver implements ListenerDriver {
  readonly sessions: FakeSession[] = [];
  opens = 0;
  /** One entry per `open`; missing entries succeed. */
  outcomes: Array<'ok' | 'fail'> = [];
  readonly events: string[] = [];

  async open(handlers: ListenerHandlers): Promise<ListenerSession> {
    this.opens += 1;
    this.events.push('open');
    if (this.outcomes.shift() === 'fail') throw new Error('connection refused');
    const session = new FakeSession(handlers);
    this.sessions.push(session);
    return session;
  }
}

function build(options: Partial<ConstructorParameters<typeof SiteChangeListener>[0]> = {}) {
  const driver = new FakeDriver();
  const changes: string[] = [];
  let resyncs = 0;
  const logger = capturingLogger();
  const listener = new SiteChangeListener({
    driver,
    onChange: (key) => changes.push(key),
    onResync: () => {
      resyncs += 1;
      driver.events.push('resync');
    },
    logger,
    pingIntervalMs: 10_000,
    backoffInitialMs: 5,
    backoffMaxMs: 20,
    stableMs: 0,
    random: () => 0.5,
    ...options,
  });
  return { driver, listener, changes, logger, resyncs: () => resyncs };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SiteChangeListener', () => {
  test('listens, resyncs once LISTEN is confirmed, and reports each changed site', async () => {
    const { driver, listener, changes, resyncs } = build();
    listener.start();
    await vi.waitFor(() => expect(listener.state).toBe('listening'));
    expect(resyncs()).toBe(1);

    driver.sessions[0]?.handlers.onNotify('shop');
    driver.sessions[0]?.handlers.onNotify('blog-2');
    expect(changes).toEqual(['shop', 'blog-2']);
    await listener.stop();
  });

  test('a payload that is not a site key resyncs everything', async () => {
    const { driver, listener, changes, resyncs } = build();
    listener.start();
    await vi.waitFor(() => expect(listener.state).toBe('listening'));
    driver.sessions[0]?.handlers.onNotify('');
    driver.sessions[0]?.handlers.onNotify('../etc');
    expect(changes).toEqual([]);
    expect(resyncs()).toBe(3);
    await listener.stop();
  });

  test('after the connection drops it reconnects, LISTENs again, and only then resyncs', async () => {
    const { driver, listener, resyncs } = build();
    listener.start();
    await vi.waitFor(() => expect(listener.state).toBe('listening'));

    driver.sessions[0]?.handlers.onClose(new Error('terminating connection'));
    await vi.waitFor(() => expect(driver.sessions).toHaveLength(2));
    await vi.waitFor(() => expect(resyncs()).toBe(2));
    expect(driver.events).toEqual(['open', 'resync', 'open', 'resync']);
    expect(driver.sessions[0]?.closed).toBe(1);
    expect(listener.state).toBe('listening');
    await listener.stop();
  });

  test('notifications from the new session are delivered', async () => {
    const { driver, listener, changes } = build();
    listener.start();
    await vi.waitFor(() => expect(listener.state).toBe('listening'));
    driver.sessions[0]?.handlers.onClose(new Error('reset'));
    await vi.waitFor(() => expect(driver.sessions).toHaveLength(2));
    driver.sessions[1]?.handlers.onNotify('shop');
    expect(changes).toEqual(['shop']);
    await listener.stop();
  });

  test('retries a failed connect with exponential backoff, without resyncing until it listens', async () => {
    vi.useFakeTimers();
    const { driver, listener, resyncs } = build({
      backoffInitialMs: 100,
      backoffMaxMs: 300,
    });
    driver.outcomes = ['fail', 'fail', 'fail', 'fail'];
    listener.start();

    await vi.advanceTimersByTimeAsync(0);
    expect(driver.opens).toBe(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(driver.opens).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(driver.opens).toBe(2);
    await vi.advanceTimersByTimeAsync(199);
    expect(driver.opens).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(driver.opens).toBe(3);
    // 400 ms is capped at 300 ms.
    await vi.advanceTimersByTimeAsync(299);
    expect(driver.opens).toBe(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(driver.opens).toBe(4);
    expect(resyncs()).toBe(0);
    expect(listener.state).toBe('reconnecting');

    await vi.advanceTimersByTimeAsync(300);
    expect(driver.opens).toBe(5);
    expect(listener.state).toBe('listening');
    expect(resyncs()).toBe(1);
    await listener.stop();
  });

  test('a session that dies at once does not reset the backoff', async () => {
    vi.useFakeTimers();
    const { driver, listener } = build({
      backoffInitialMs: 100,
      backoffMaxMs: 10_000,
      stableMs: 1_000,
    });
    listener.start();
    await vi.advanceTimersByTimeAsync(0);
    driver.sessions[0]?.handlers.onClose(new Error('reset'));
    await vi.advanceTimersByTimeAsync(99);
    expect(driver.opens).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(driver.opens).toBe(2);

    driver.sessions[1]?.handlers.onClose(new Error('reset'));
    await vi.advanceTimersByTimeAsync(199);
    expect(driver.opens).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(driver.opens).toBe(3);
    await listener.stop();
  });

  test('a session that stayed up resets the backoff', async () => {
    vi.useFakeTimers();
    const { driver, listener } = build({
      backoffInitialMs: 100,
      backoffMaxMs: 10_000,
      stableMs: 1_000,
    });
    listener.start();
    await vi.advanceTimersByTimeAsync(0);
    driver.sessions[0]?.handlers.onClose(new Error('reset'));
    await vi.advanceTimersByTimeAsync(100);
    expect(driver.opens).toBe(2);

    await vi.advanceTimersByTimeAsync(5_000);
    driver.sessions[1]?.handlers.onClose(new Error('reset'));
    await vi.advanceTimersByTimeAsync(100);
    expect(driver.opens).toBe(3);
    await listener.stop();
  });

  test('uses 500 ms doubling up to 30 s, with random jitter, when no backoff is configured', async () => {
    vi.useFakeTimers();
    // 0.5 is the middle of the jitter range: no jitter.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const driver = new FakeDriver();
    driver.outcomes = ['fail', 'fail', 'fail', 'fail', 'fail', 'fail', 'fail'];
    const listener = new SiteChangeListener({ driver, onChange: () => {}, onResync: () => {} });
    listener.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(driver.opens).toBe(1);

    // Seven failures: 500, 1000, 2000, 4000, 8000, 16000, and 32000 capped at 30000.
    let opens = 1;
    for (const delay of [500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000]) {
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(driver.opens).toBe(opens);
      await vi.advanceTimersByTimeAsync(1);
      opens += 1;
      expect(driver.opens).toBe(opens);
    }
    expect(listener.state).toBe('listening');
    await listener.stop();
  });

  test('the jitter keeps the wait within 20% of the backoff', async () => {
    vi.useFakeTimers();
    const driver = new FakeDriver();
    driver.outcomes = ['fail'];
    const listener = new SiteChangeListener({
      driver,
      onChange: () => {},
      onResync: () => {},
      backoffInitialMs: 1_000,
      random: () => 0,
    });
    listener.start();
    await vi.advanceTimersByTimeAsync(0);
    // random() = 0 is the shortest wait: 80%.
    await vi.advanceTimersByTimeAsync(799);
    expect(driver.opens).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(driver.opens).toBe(2);
    await listener.stop();
  });

  test('a session that cannot be closed does not stop the reconnect', async () => {
    const { driver, listener, resyncs } = build();
    listener.start();
    await vi.waitFor(() => expect(listener.state).toBe('listening'));
    const first = driver.sessions[0];
    if (first === undefined) throw new Error('no session');
    first.close = async () => {
      throw new Error('socket hang up');
    };

    first.handlers.onClose(new Error('reset'));
    await vi.waitFor(() => expect(driver.sessions).toHaveLength(2));
    await vi.waitFor(() => expect(resyncs()).toBe(2));
    expect(listener.state).toBe('listening');
    await listener.stop();
  });

  test('a failed ping ends the session and triggers a reconnect', async () => {
    const { driver, listener, resyncs } = build({ pingIntervalMs: 5 });
    listener.start();
    await vi.waitFor(() => expect(listener.state).toBe('listening'));
    const first = driver.sessions[0];
    if (first === undefined) throw new Error('no session');
    first.ping = async () => {
      throw new Error('The listener is connected to a standby');
    };
    await vi.waitFor(() => expect(driver.sessions.length).toBeGreaterThanOrEqual(2));
    await vi.waitFor(() => expect(resyncs()).toBe(2));
    expect(first.closed).toBe(1);
    await listener.stop();
  });

  test('a ping that never answers counts as a dead connection', async () => {
    const { driver, listener } = build({ pingIntervalMs: 5, pingTimeoutMs: 15 });
    listener.start();
    await vi.waitFor(() => expect(listener.state).toBe('listening'));
    const first = driver.sessions[0];
    if (first === undefined) throw new Error('no session');
    first.ping = () => new Promise<void>(() => {});
    await vi.waitFor(() => expect(driver.sessions.length).toBeGreaterThanOrEqual(2));
    expect(first.closed).toBe(1);
    await listener.stop();
  });

  test('pings a healthy session on every interval without reconnecting', async () => {
    const { driver, listener } = build({ pingIntervalMs: 5 });
    listener.start();
    await vi.waitFor(() => expect(listener.state).toBe('listening'));
    const session = driver.sessions[0];
    if (session === undefined) throw new Error('no session');
    const ping = vi.fn(async () => {});
    session.ping = ping;
    await vi.waitFor(() => expect(ping.mock.calls.length).toBeGreaterThanOrEqual(3));
    expect(driver.opens).toBe(1);
    await listener.stop();
  });

  test('stop closes the session and does not reconnect', async () => {
    const { driver, listener } = build();
    listener.start();
    await vi.waitFor(() => expect(listener.state).toBe('listening'));
    await listener.stop();
    expect(listener.state).toBe('stopped');
    expect(driver.sessions[0]?.closed).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(driver.opens).toBe(1);
  });

  test('stop during the backoff returns at once', async () => {
    vi.useFakeTimers();
    const { driver, listener } = build({ backoffInitialMs: 60_000, backoffMaxMs: 60_000 });
    driver.outcomes = ['fail'];
    listener.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(listener.state).toBe('reconnecting');
    await listener.stop();
    expect(listener.state).toBe('stopped');
    expect(driver.opens).toBe(1);
  });

  test('stop while a connect is still in flight closes the session it ends up with', async () => {
    const gate = deferred();
    const driver = new FakeDriver();
    const open = driver.open.bind(driver);
    driver.open = async (handlers) => {
      await gate.promise;
      return open(handlers);
    };
    const listener = new SiteChangeListener({ driver, onChange: () => {}, onResync: () => {} });
    listener.start();
    const stopping = listener.stop();
    gate.resolve();
    await stopping;
    expect(driver.sessions[0]?.closed).toBe(1);
  });

  test('a throwing handler is logged and does not stop the listener', async () => {
    const { driver, logger } = build();
    const listener = new SiteChangeListener({
      driver,
      onChange: () => {
        throw new Error('boom');
      },
      onResync: () => {},
      logger,
      pingIntervalMs: 10_000,
    });
    listener.start();
    await vi.waitFor(() => expect(listener.state).toBe('listening'));
    driver.sessions[0]?.handlers.onNotify('shop');
    expect(logger.lines.some((line) => line.level === 'error')).toBe(true);
    expect(listener.state).toBe('listening');
    await listener.stop();
  });
});
