// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type postgres from 'postgres';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { SiteChangeListener } from './listener.js';
import { createPostgresListenerDriver } from './listener-driver.js';
import { SITE_CHANNEL } from './listener-types.js';

/*
 * The postgres.js driver of the listener, against a stand-in for postgres.js: the real connection,
 * `NOTIFY` and a cut connection are exercised in integration.test.ts. What only a stand-in can do
 * is fail `LISTEN`, answer from a standby, and deliver notices and foreign channels.
 */

type DriverOptions = postgres.Options<Record<string, postgres.PostgresType>> & {
  onnotify: (name: string, payload: string) => void;
};

interface FakeSql {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown[]>;
  unsafe: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
}

interface Connection {
  readonly url: string;
  readonly options: DriverOptions;
  readonly sql: FakeSql;
}

const connections: Connection[] = [];
const hoisted = vi.hoisted(() => ({ factory: vi.fn() }));

vi.mock('postgres', () => ({ default: hoisted.factory }));

/** What the connections answer; the defaults are a healthy primary. */
const behaviour: {
  listen: () => Promise<unknown>;
  end: () => Promise<unknown>;
  rows: () => Promise<unknown[]>;
} = {
  listen: async () => [],
  end: async () => undefined,
  rows: async () => [{ in_recovery: false }],
};

beforeEach(() => {
  connections.length = 0;
  behaviour.listen = async () => [];
  behaviour.end = async () => undefined;
  behaviour.rows = async () => [{ in_recovery: false }];
  hoisted.factory.mockReset();
  hoisted.factory.mockImplementation((url: string, options: DriverOptions) => {
    const query = vi.fn((..._args: unknown[]) => behaviour.rows());
    const sql = Object.assign(
      (strings: TemplateStringsArray, ...values: unknown[]) => query(strings, ...values),
      {
        query,
        unsafe: vi.fn(() => behaviour.listen()),
        end: vi.fn(() => behaviour.end()),
      },
    ) as unknown as FakeSql;
    connections.push({ url, options, sql });
    return sql;
  });
});

function handlers() {
  return {
    onNotify: vi.fn<(payload: string) => void>(),
    onClose: vi.fn<(reason: unknown) => void>(),
  };
}

function only(): Connection {
  const connection = connections[0];
  if (connection === undefined) throw new Error('no connection was opened');
  return connection;
}

const URL_C15T = 'postgres://c15t_api:pw@db.invalid:5432/consent';

describe('createPostgresListenerDriver', () => {
  test('opens one dedicated connection to the primary and LISTENs on the site channel', async () => {
    const driver = createPostgresListenerDriver({ url: URL_C15T });
    await driver.open(handlers());

    expect(connections).toHaveLength(1);
    expect(only().url).toBe(URL_C15T);
    expect(only().options).toMatchObject({
      max: 1,
      max_lifetime: null,
      connect_timeout: 5,
      keep_alive: 30,
      target_session_attrs: 'read-write',
      fetch_types: false,
      connection: { application_name: 'consent-api-listener' },
    });
    expect(only().sql.unsafe).toHaveBeenCalledExactlyOnceWith(`listen "${SITE_CHANNEL}"`);
  });

  test('takes the timeouts and the channel from the options, and quotes the channel name', async () => {
    const driver = createPostgresListenerDriver({
      url: URL_C15T,
      channel: 'odd"name',
      connectTimeoutSeconds: 2,
      keepAliveSeconds: 7,
    });
    await driver.open(handlers());

    expect(only().options).toMatchObject({ connect_timeout: 2, keep_alive: 7 });
    expect(only().sql.unsafe).toHaveBeenCalledExactlyOnceWith('listen "odd""name"');
  });

  test('hands the payloads of its own channel on, and nothing from other channels', async () => {
    const h = handlers();
    await createPostgresListenerDriver({ url: URL_C15T }).open(h);

    only().options.onnotify(SITE_CHANNEL, 'shop');
    only().options.onnotify('some_other_channel', 'blog');
    only().options.onnotify(SITE_CHANNEL, 'blog-2');

    expect(h.onNotify.mock.calls).toEqual([['shop'], ['blog-2']]);
  });

  test('listens on the channel it was given, not on the default one', async () => {
    const h = handlers();
    await createPostgresListenerDriver({ url: URL_C15T, channel: 'custom' }).open(h);

    only().options.onnotify(SITE_CHANNEL, 'shop');
    only().options.onnotify('custom', 'blog');

    expect(h.onNotify.mock.calls).toEqual([['blog']]);
  });

  test('ignores server notices', async () => {
    await createPostgresListenerDriver({ url: URL_C15T }).open(handlers());
    expect(only().options.onnotice?.({ message: 'relation exists' })).toBeUndefined();
  });

  test('a closed connection ends the session once, and never reconnects by itself', async () => {
    const h = handlers();
    await createPostgresListenerDriver({ url: URL_C15T }).open(h);

    only().options.onclose?.(1);
    only().options.onclose?.(1);

    expect(h.onClose).toHaveBeenCalledTimes(1);
    expect(h.onClose.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(connections).toHaveLength(1);
  });

  test('closing the session ends the connection and is not reported as a loss', async () => {
    const h = handlers();
    const session = await createPostgresListenerDriver({ url: URL_C15T }).open(h);

    await session.close();
    only().options.onclose?.(1);

    expect(only().sql.end).toHaveBeenCalledExactlyOnceWith({ timeout: 2 });
    expect(h.onClose).not.toHaveBeenCalled();
  });

  test('when LISTEN fails it ends the connection, reports the failure and stays quiet', async () => {
    const failure = Object.assign(new Error('permission denied'), { code: '42501' });
    behaviour.listen = async () => {
      throw failure;
    };
    const h = handlers();

    await expect(createPostgresListenerDriver({ url: URL_C15T }).open(h)).rejects.toBe(failure);

    expect(only().sql.end).toHaveBeenCalledExactlyOnceWith({ timeout: 0 });
    only().options.onclose?.(1);
    expect(h.onClose).not.toHaveBeenCalled();
  });

  test('a connection that cannot even be ended does not hide the reason LISTEN failed', async () => {
    const failure = new Error('connection refused');
    behaviour.listen = async () => {
      throw failure;
    };
    behaviour.end = async () => {
      throw new Error('already closed');
    };

    await expect(createPostgresListenerDriver({ url: URL_C15T }).open(handlers())).rejects.toBe(
      failure,
    );
  });

  describe('ping', () => {
    test('resolves on a primary', async () => {
      const session = await createPostgresListenerDriver({ url: URL_C15T }).open(handlers());
      await expect(session.ping()).resolves.toBeUndefined();
      expect(only().sql.query).toHaveBeenCalledTimes(1);
    });

    test('rejects when the node was demoted without dropping the connection', async () => {
      const session = await createPostgresListenerDriver({ url: URL_C15T }).open(handlers());
      behaviour.rows = async () => [{ in_recovery: true }];
      await expect(session.ping()).rejects.toThrow('The listener is connected to a standby');
    });

    test('rejects when the answer is not a clear "not in recovery"', async () => {
      const session = await createPostgresListenerDriver({ url: URL_C15T }).open(handlers());
      behaviour.rows = async () => [];
      await expect(session.ping()).rejects.toThrow('standby');
      behaviour.rows = async () => [{ in_recovery: null }];
      await expect(session.ping()).rejects.toThrow('standby');
    });

    test('rejects with the error of a dead connection', async () => {
      const session = await createPostgresListenerDriver({ url: URL_C15T }).open(handlers());
      behaviour.rows = async () => {
        throw new Error('write CONNECTION_CLOSED');
      };
      await expect(session.ping()).rejects.toThrow('CONNECTION_CLOSED');
    });
  });
});

describe('SiteChangeListener on the postgres.js driver', () => {
  test('delivers changes, and after the connection closes opens a new one and resyncs', async () => {
    const changes: string[] = [];
    let resyncs = 0;
    const listener = new SiteChangeListener({
      driver: createPostgresListenerDriver({ url: URL_C15T }),
      onChange: (key) => changes.push(key),
      onResync: () => {
        resyncs += 1;
      },
      backoffInitialMs: 1,
      backoffMaxMs: 1,
      random: () => 0.5,
    });
    listener.start();
    await vi.waitFor(() => expect(listener.state).toBe('listening'));
    expect(resyncs).toBe(1);
    only().options.onnotify(SITE_CHANNEL, 'shop');
    expect(changes).toEqual(['shop']);

    only().options.onclose?.(1);
    await vi.waitFor(() => expect(connections).toHaveLength(2));
    await vi.waitFor(() => expect(resyncs).toBe(2));
    connections[1]?.options.onnotify(SITE_CHANNEL, 'blog');
    expect(changes).toEqual(['shop', 'blog']);
    expect(listener.state).toBe('listening');

    await listener.stop();
    expect(connections[1]?.sql.end).toHaveBeenCalledWith({ timeout: 2 });
  });
});
