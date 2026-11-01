// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AppDeps } from './app-types.js';
import type { ListenerOptions } from './listener-types.js';
import type { RegistryOptions } from './registry-types.js';
import { siteRecord } from './testing/fakes.js';

/*
 * server.ts is the process entry point: importing it starts the service. The heavy parts (Postgres,
 * the HTTP server, the registry, the listener) are stand-ins; what is checked is the wiring from the
 * environment, and above all how the process starts, stops and fails.
 */

interface LogLine {
  readonly level: string;
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>> | undefined;
}

const h = vi.hoisted(() => {
  const order: string[] = [];
  const lines: LogLine[] = [];
  const record =
    (level: string) =>
    (message: string, fields?: Readonly<Record<string, unknown>>): void => {
      lines.push({ level, message, fields });
    };

  class FakeRegistry {
    static readonly created: FakeRegistry[] = [];
    readonly invalidate = vi.fn();
    readonly invalidateAll = vi.fn();
    readonly close = vi.fn(async () => {
      order.push('registry.close');
    });
    readonly options: RegistryOptions;
    constructor(options: RegistryOptions) {
      this.options = options;
      FakeRegistry.created.push(this);
    }
  }

  class FakeListener {
    static readonly created: FakeListener[] = [];
    state = 'starting';
    readonly start = vi.fn();
    readonly stop = vi.fn(async () => {
      order.push('listener.stop');
    });
    readonly options: ListenerOptions;
    constructor(options: ListenerOptions) {
      this.options = options;
      FakeListener.created.push(this);
    }
  }

  return {
    order,
    lines,
    logger: { info: record('info'), warn: record('warn'), error: record('error') },
    FakeRegistry,
    FakeListener,
    createPool: vi.fn(),
    createPgSiteStore: vi.fn(),
    createApp: vi.fn<(deps: AppDeps) => unknown>(),
    createSiteInstance: vi.fn(),
    createDriver: vi.fn(),
    serve: vi.fn<(options: Served['options'], onListening: Served['onListening']) => unknown>(),
  };
});

vi.mock('@consent/db', () => ({ createPool: h.createPool }));
vi.mock('@hono/node-server', () => ({ serve: h.serve }));
vi.mock('./app.js', () => ({ createApp: h.createApp }));
vi.mock('./instance.js', () => ({ createSiteInstance: h.createSiteInstance }));
vi.mock('./listener-driver.js', () => ({ createPostgresListenerDriver: h.createDriver }));
vi.mock('./listener.js', () => ({ SiteChangeListener: h.FakeListener }));
vi.mock('./registry.js', () => ({ SiteRegistry: h.FakeRegistry }));
vi.mock('./site-store.js', () => ({ createPgSiteStore: h.createPgSiteStore }));
vi.mock('./log.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./log.js')>()),
  createLogger: () => h.logger,
}));

const DB_URL = 'postgres://c15t_api:pw@db.invalid:5432/consent';
const API_KEY = 'k'.repeat(32);

interface FakeServer extends EventEmitter {
  close: ReturnType<typeof vi.fn>;
  closeIdleConnections?: ReturnType<typeof vi.fn>;
  closeAllConnections?: ReturnType<typeof vi.fn>;
  keepAliveTimeout?: number;
  headersTimeout?: number;
  requestTimeout?: number;
  /** The callback `server.close` was given: the server calls it once the last request is done. */
  finishClose: () => void;
}

/** `node`: what `node:http` offers. `bare`: a server that offers neither timeouts nor force-close. */
function makeServer(kind: 'node' | 'bare'): FakeServer {
  const server = new EventEmitter() as FakeServer;
  let onClosed: (() => void) | undefined;
  server.close = vi.fn((callback?: () => void) => {
    onClosed = callback;
    return server;
  });
  server.finishClose = () => onClosed?.();
  if (kind === 'node') {
    server.closeIdleConnections = vi.fn();
    server.closeAllConnections = vi.fn();
    server.keepAliveTimeout = 5_000;
    server.headersTimeout = 60_000;
    server.requestTimeout = 300_000;
  }
  return server;
}

interface Served {
  readonly options: { fetch: unknown; hostname: string; port: number };
  readonly onListening: (info: { address: string; port: number }) => void;
}

let server: FakeServer;
let served: Served | undefined;
const sql = { end: vi.fn() };
const store = { find: vi.fn(), check: vi.fn() };
const app = { fetch: vi.fn() };
const instance = { handler: vi.fn(), dispose: vi.fn() };
const driver = { open: vi.fn() };

const handlers = new Map<string, () => void>();
const originalExitCode = process.exitCode;

function useEnv(overrides: Record<string, string> = {}): void {
  const values = {
    CONSENT_API_HOST: '10.1.2.3',
    CONSENT_API_PORT: '4300',
    CONSENT_API_TRUSTED_PROXIES: '10.0.0.0/8',
    DATABASE_URL_C15T: DB_URL,
    C15T_ADMIN_API_KEY: API_KEY,
    CONSENT_API_INSTANCE_POOL_MAX: '3',
    CONSENT_API_REGISTRY_POOL_MAX: '1',
    CONSENT_API_DB_PREPARE: 'false',
    ...overrides,
  };
  for (const [name, value] of Object.entries(values)) vi.stubEnv(name, value);
}

async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

/** Imports server.ts, which starts the service. */
async function start(): Promise<void> {
  vi.resetModules();
  await import('./server.js');
  await flush();
}

function registry(): InstanceType<typeof h.FakeRegistry> {
  const last = h.FakeRegistry.created.at(-1);
  if (last === undefined) throw new Error('no registry was created');
  return last;
}

function listener(): InstanceType<typeof h.FakeListener> {
  const last = h.FakeListener.created.at(-1);
  if (last === undefined) throw new Error('no listener was created');
  return last;
}

function signal(name: string): void {
  const handler = handlers.get(name);
  if (handler === undefined) throw new Error(`nothing listens for ${name}`);
  handler();
}

const messages = (): string[] => h.lines.map((line) => line.message);
const logged = (message: string): LogLine | undefined =>
  h.lines.find((line) => line.message === message);

beforeEach(() => {
  vi.useFakeTimers();
  h.order.length = 0;
  h.lines.length = 0;
  h.FakeRegistry.created.length = 0;
  h.FakeListener.created.length = 0;
  handlers.clear();
  served = undefined;
  server = makeServer('node');

  sql.end.mockReset().mockImplementation(async () => {
    h.order.push('sql.end');
  });
  store.check.mockReset().mockResolvedValue({ activeSites: 4 });
  h.createPool.mockReset().mockReturnValue(sql);
  h.createPgSiteStore.mockReset().mockReturnValue(store);
  h.createApp.mockReset().mockReturnValue(app);
  h.createSiteInstance.mockReset().mockReturnValue(instance);
  h.createDriver.mockReset().mockReturnValue(driver);
  h.serve.mockReset().mockImplementation((options, onListening) => {
    served = { options, onListening };
    return server;
  });

  // The test must not install real signal or rejection handlers on the test worker.
  const realOn = process.on.bind(process);
  const realOnce = process.once.bind(process);
  const capture =
    (real: (event: string, listener: (...args: unknown[]) => void) => unknown) =>
    (event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'SIGTERM' || event === 'SIGINT' || event === 'unhandledRejection') {
        handlers.set(event, handler);
        return process;
      }
      return real(event, handler);
    };
  vi.spyOn(process, 'on').mockImplementation(capture(realOn) as unknown as typeof process.on);
  vi.spyOn(process, 'once').mockImplementation(capture(realOnce) as unknown as typeof process.once);
  vi.spyOn(process, 'exit').mockImplementation((() => undefined) as unknown as typeof process.exit);
  process.exitCode = undefined;
  useEnv();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = originalExitCode;
});

describe('startup', () => {
  test('opens the registry pool on the primary with the sizes from the environment', async () => {
    await start();
    expect(h.createPool).toHaveBeenCalledExactlyOnceWith({
      url: DB_URL,
      role: 'primary',
      applicationName: 'consent-api',
      max: 1,
    });
    expect(h.createPgSiteStore).toHaveBeenCalledExactlyOnceWith(sql);
    expect(registry().options.store).toBe(store);
  });

  test('builds each site instance with the key and the database settings of the environment', async () => {
    await start();
    const site = siteRecord('shop');
    expect(registry().options.factory(site)).toBe(instance);
    expect(h.createSiteInstance).toHaveBeenCalledExactlyOnceWith(site, {
      apiKey: API_KEY,
      database: { url: DB_URL, poolMax: 3, prepare: false, maxLifetimeSeconds: 300 },
    });
  });

  test('a changed site is forgotten, and a resync forgets every site', async () => {
    await start();
    expect(h.createDriver).toHaveBeenCalledExactlyOnceWith({ url: DB_URL });
    expect(listener().options.driver).toBe(driver);

    listener().options.onChange('shop');
    expect(registry().invalidate).toHaveBeenCalledExactlyOnceWith('shop');
    expect(logged('site changed')?.fields).toEqual({ siteKey: 'shop' });
    expect(registry().invalidateAll).not.toHaveBeenCalled();

    listener().options.onResync();
    expect(registry().invalidateAll).toHaveBeenCalledTimes(1);
    expect(registry().invalidate).toHaveBeenCalledTimes(1);
  });

  test('serves the app on the configured address, with the registry, proxies and probes wired in', async () => {
    await start();
    const options = h.createApp.mock.calls[0]?.[0];
    if (options === undefined) throw new Error('createApp was not called');
    expect(options.registry).toBe(registry());
    expect(options.trustedProxies).toEqual(['10.0.0.0/8']);
    expect(options.logger).toBe(h.logger);

    await expect(options.readiness()).resolves.toEqual({ activeSites: 4 });
    expect(store.check).toHaveBeenCalledTimes(1);
    listener().state = 'reconnecting';
    expect(options.listenerState()).toBe('reconnecting');

    expect(served?.options).toEqual({ fetch: app.fetch, hostname: '10.1.2.3', port: 4300 });
    expect(logged('consent-api listening')).toBeUndefined();
    served?.onListening({ address: '10.1.2.3', port: 4300 });
    expect(logged('consent-api listening')?.fields).toEqual({ host: '10.1.2.3', port: 4300 });
  });

  test('starts listening for site changes once the server is up', async () => {
    await start();
    expect(listener().start).toHaveBeenCalledTimes(1);
  });

  test('sets timeouts that outlast the keep-alive of nginx', async () => {
    await start();
    expect(server.keepAliveTimeout).toBe(75_000);
    expect(server.headersTimeout).toBe(80_000);
    expect(server.requestTimeout).toBe(30_000);
  });

  test('copes with a server that has no such timeouts', async () => {
    server = makeServer('bare');
    await start();
    expect(server.keepAliveTimeout).toBeUndefined();
    expect(listener().start).toHaveBeenCalledTimes(1);
  });

  test('stops on SIGTERM and SIGINT, and survives a rejected promise in a driver', async () => {
    await start();
    expect([...handlers.keys()].sort((a, b) => a.localeCompare(b))).toEqual([
      'SIGINT',
      'SIGTERM',
      'unhandledRejection',
    ]);

    const reject = handlers.get('unhandledRejection') as unknown as (reason: unknown) => void;
    reject(Object.assign(new Error('driver exploded'), { code: 'XX000' }));
    expect(logged('unhandled rejection')).toMatchObject({
      level: 'error',
      fields: { error: 'Error', message: 'driver exploded', code: 'XX000' },
    });
    expect(process.exit).not.toHaveBeenCalled();
    expect(server.close).not.toHaveBeenCalled();
  });
});

describe('startup failure', () => {
  test('an invalid environment is logged without its values, and the exit code is non-zero', async () => {
    useEnv({ DATABASE_URL_C15T: 'mysql://user:hunter2@db.internal/app' });
    await start();

    const failure = logged('startup failed');
    expect(failure?.level).toBe('error');
    expect(failure?.fields?.['error']).toBe('EnvError');
    expect(JSON.stringify(failure)).not.toContain('hunter2');
    expect(process.exitCode).toBe(1);
    expect(h.createPool).not.toHaveBeenCalled();
    expect(h.serve).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });

  test('a failure while wiring is logged too', async () => {
    h.createPool.mockImplementation(() => {
      throw Object.assign(new Error('bad connection settings'), { code: 'ERR_X' });
    });
    await start();
    expect(logged('startup failed')?.fields).toMatchObject({
      message: 'bad connection settings',
      code: 'ERR_X',
    });
    expect(process.exitCode).toBe(1);
    expect(h.serve).not.toHaveBeenCalled();
  });
});

describe('shutdown', () => {
  test.each(['SIGTERM', 'SIGINT'])(
    '%s stops accepting, waits for in-flight requests, then closes the listener, the instances and the pool',
    async (name) => {
      await start();
      signal(name);
      await flush();

      expect(logged('shutting down')?.fields).toEqual({ signal: name });
      expect(server.close).toHaveBeenCalledTimes(1);
      expect(server.closeIdleConnections).toHaveBeenCalledTimes(1);
      // A request is still running: nothing behind the server is closed yet.
      expect(h.order).toEqual([]);

      server.finishClose();
      await flush();

      expect(h.order).toEqual(['listener.stop', 'registry.close', 'sql.end']);
      expect(sql.end).toHaveBeenCalledExactlyOnceWith({ timeout: 5 });
      expect(messages()).toContain('shutdown complete');
      expect(process.exitCode).toBeUndefined();

      // Done in time: the deadlines no longer fire.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(server.closeAllConnections).not.toHaveBeenCalled();
    },
  );

  test('a second signal while shutting down changes nothing', async () => {
    await start();
    signal('SIGTERM');
    signal('SIGINT');
    signal('SIGTERM');
    await flush();

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(h.lines.filter((line) => line.message === 'shutting down')).toHaveLength(1);
    server.finishClose();
    await flush();
    expect(listener().stop).toHaveBeenCalledTimes(1);
    expect(registry().close).toHaveBeenCalledTimes(1);
    expect(sql.end).toHaveBeenCalledTimes(1);
  });

  test('connections that are still busy after 10 s are cut so the shutdown can finish', async () => {
    await start();
    signal('SIGTERM');
    await flush();

    await vi.advanceTimersByTimeAsync(9_999);
    expect(server.closeAllConnections).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);

    server.finishClose();
    await flush();
    expect(messages()).toContain('shutdown complete');
  });

  test('a server without force-close still shuts down', async () => {
    server = makeServer('bare');
    await start();
    signal('SIGTERM');
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);

    server.finishClose();
    await flush();
    expect(h.order).toEqual(['listener.stop', 'registry.close', 'sql.end']);
    expect(messages()).toContain('shutdown complete');
  });

  test('a shutdown that hangs is ended after 20 s with a non-zero exit', async () => {
    await start();
    signal('SIGTERM');
    await flush();

    await vi.advanceTimersByTimeAsync(19_999);
    expect(process.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(logged('shutdown timed out')?.level).toBe('error');
    expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  test('a step that fails is logged, the exit code is non-zero, and the process is not killed', async () => {
    await start();
    registry().close.mockRejectedValueOnce(
      Object.assign(new Error('pool is already closed'), { code: 'ERR_POOL' }),
    );
    signal('SIGTERM');
    server.finishClose();
    await flush();

    expect(logged('shutdown failed')).toMatchObject({
      level: 'error',
      fields: { message: 'pool is already closed', code: 'ERR_POOL' },
    });
    expect(process.exitCode).toBe(1);
    expect(messages()).not.toContain('shutdown complete');
    expect(process.exit).not.toHaveBeenCalled();
  });

  test('a server error such as EADDRINUSE logs, exits non-zero and releases everything', async () => {
    await start();
    server.emit('error', Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' }));
    await flush();

    expect(logged('server error')?.fields).toEqual({
      error: 'Error',
      message: 'listen EADDRINUSE',
      code: 'EADDRINUSE',
    });
    expect(process.exitCode).toBe(1);
    expect(logged('shutting down')?.fields).toEqual({ signal: 'server error' });

    server.finishClose();
    await flush();
    expect(h.order).toEqual(['listener.stop', 'registry.close', 'sql.end']);
    expect(process.exitCode).toBe(1);
  });
});
