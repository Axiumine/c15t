// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { fieldOf } from '@consent/shared';
import { afterEach, beforeEach, describe, expect, type MockInstance, test, vi } from 'vitest';

/*
 * server.ts is the process entry point: it runs on import. Every test gets a fresh module
 * registry, a fake listener and fake process hooks, so nothing here listens on a port, installs a
 * real signal handler or exits the test worker.
 */

type Listening = (info: { address: string; port: number }) => void;
type Log = (message: string, fields?: Record<string, unknown>) => void;

const mocks = vi.hoisted(() => ({
  serve: vi.fn<(options: unknown, onListening?: Listening) => unknown>(),
  compose: vi.fn(),
  loadEnv: vi.fn(),
  logger: { info: vi.fn<Log>(), warn: vi.fn<Log>(), error: vi.fn<Log>() },
}));

vi.mock('@hono/node-server', () => ({ serve: mocks.serve }));
vi.mock('./compose.js', () => ({ compose: mocks.compose }));
vi.mock('./logger.js', () => ({ consoleLogger: mocks.logger }));
vi.mock('./env.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./env.js')>()),
  loadEnv: mocks.loadEnv,
}));

class ExitSignal extends Error {
  readonly code: string | number | null | undefined;

  constructor(code: string | number | null | undefined) {
    super(`process.exit(${String(code)})`);
    this.code = code;
  }
}

type Handler = (...args: unknown[]) => void;

const env = { DASHBOARD_API_HOST: '10.0.0.5', DASHBOARD_API_PORT: 4321 };
const fetch = vi.fn();
const dbClose = vi.fn();

let handlers: Map<string, Handler>;
let registeredWith: Map<string, 'once' | 'on'>;
const spyOnExit = () => vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
let exit: MockInstance<typeof process.exit>;
let closeCallback: (() => void) | undefined;
let listening: Listening | undefined;
let server: { close: ReturnType<typeof vi.fn>; closeIdleConnections?: ReturnType<typeof vi.fn> };

function trackProcessHooks() {
  handlers = new Map();
  registeredWith = new Map();
  for (const method of ['once', 'on'] as const) {
    vi.spyOn(process, method).mockImplementation(((event: string, handler: Handler) => {
      handlers.set(event, handler);
      registeredWith.set(event, method);
      return process;
    }) as never);
  }
  exit = spyOnExit();
}

async function start() {
  vi.resetModules();
  await import('./server.js');
}

function signal(name: string) {
  const handler = handlers.get(name);
  if (handler === undefined) throw new Error(`no handler for ${name}`);
  handler(name);
}

beforeEach(() => {
  vi.useFakeTimers();
  for (const mock of [mocks.serve, mocks.compose, mocks.loadEnv, fetch, dbClose]) mock.mockReset();
  for (const log of Object.values(mocks.logger)) log.mockReset();
  closeCallback = undefined;
  listening = undefined;
  server = {
    close: vi.fn((callback: () => void) => {
      closeCallback = callback;
    }),
    closeIdleConnections: vi.fn(),
  };
  mocks.loadEnv.mockReturnValue(env);
  mocks.compose.mockReturnValue({ app: { fetch }, db: { close: dbClose } });
  mocks.serve.mockImplementation((_options: unknown, onListening: typeof listening) => {
    listening = onListening;
    return server;
  });
  dbClose.mockResolvedValue(undefined);
  trackProcessHooks();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('startup', () => {
  test('composes the app from the validated environment and listens where it says', async () => {
    await start();
    expect(mocks.compose).toHaveBeenCalledExactlyOnceWith(env, mocks.logger);
    expect(mocks.serve).toHaveBeenCalledOnce();
    expect(mocks.serve.mock.calls[0]?.[0]).toEqual({
      fetch,
      hostname: '10.0.0.5',
      port: 4321,
    });
    expect(exit).not.toHaveBeenCalled();
  });

  test('logs the address it is really listening on', async () => {
    await start();
    expect(mocks.logger.info).not.toHaveBeenCalled();
    listening?.({ address: '10.0.0.5', port: 4321 });
    expect(mocks.logger.info).toHaveBeenCalledExactlyOnceWith('dashboard-api listening', {
      host: '10.0.0.5',
      port: 4321,
    });
  });

  test('registers the signal handlers once and the rejection handler for good', async () => {
    await start();
    expect(registeredWith.get('SIGTERM')).toBe('once');
    expect(registeredWith.get('SIGINT')).toBe('once');
    expect(registeredWith.get('unhandledRejection')).toBe('on');
  });

  test('an invalid environment is reported by variable name and ends the process with 1', async () => {
    vi.resetModules();
    const { EnvError } = await import('./env.js');
    mocks.loadEnv.mockImplementation(() => {
      throw new EnvError(['BETTER_AUTH_SECRET: Must be at least 32 characters']);
    });
    exit.mockImplementation((code) => {
      throw new ExitSignal(typeof code === 'number' ? code : undefined);
    });
    await expect(import('./server.js')).rejects.toMatchObject({ code: 1 });
    expect(mocks.logger.error).toHaveBeenCalledExactlyOnceWith('invalid configuration', {
      problems: ['BETTER_AUTH_SECRET: Must be at least 32 characters'],
    });
    expect(mocks.serve).not.toHaveBeenCalled();
    expect(mocks.compose).not.toHaveBeenCalled();
  });

  test('an unexpected environment failure is logged without its message', async () => {
    mocks.loadEnv.mockImplementation(() => {
      throw new Error('reading the secret failed: s3cr3t');
    });
    exit.mockImplementation((code) => {
      throw new ExitSignal(typeof code === 'number' ? code : undefined);
    });
    await expect(start()).rejects.toMatchObject({ code: 1 });
    expect(mocks.logger.error).toHaveBeenCalledExactlyOnceWith('invalid configuration', {
      problems: ['unreadable environment'],
    });
    expect(JSON.stringify(mocks.logger.error.mock.calls)).not.toContain('s3cr3t');
    expect(mocks.serve).not.toHaveBeenCalled();
  });
});

describe('shutdown', () => {
  test('SIGTERM stops accepting, drops idle connections, closes the pools and exits 0', async () => {
    await start();
    signal('SIGTERM');
    expect(mocks.logger.info).toHaveBeenCalledWith('shutting down', { signal: 'SIGTERM' });
    expect(server.close).toHaveBeenCalledOnce();
    expect(server.closeIdleConnections).toHaveBeenCalledOnce();
    // The pools stay open until the last in-flight request has finished.
    expect(dbClose).not.toHaveBeenCalled();
    closeCallback?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(dbClose).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  test('SIGINT shuts down the same way', async () => {
    await start();
    signal('SIGINT');
    expect(mocks.logger.info).toHaveBeenCalledWith('shutting down', { signal: 'SIGINT' });
    closeCallback?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  test('a second signal while closing is ignored', async () => {
    await start();
    signal('SIGTERM');
    signal('SIGINT');
    expect(server.close).toHaveBeenCalledOnce();
    expect(mocks.logger.info).toHaveBeenCalledTimes(1);
  });

  test('exits 1 when the pools cannot be closed', async () => {
    dbClose.mockRejectedValue(new Error('pool is stuck'));
    await start();
    signal('SIGTERM');
    closeCallback?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  test('works with a listener that has no closeIdleConnections', async () => {
    server = { close: server.close };
    await start();
    signal('SIGTERM');
    expect(server.close).toHaveBeenCalledOnce();
    closeCallback?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  test('gives up after 10 s when a connection never ends, and that timer cannot hold the process', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    await start();
    signal('SIGTERM');
    const timer = fieldOf(setTimeoutSpy.mock.results[0], 'value') as { hasRef(): boolean };
    expect(timer.hasRef()).toBe(false);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.logger.error).toHaveBeenCalledExactlyOnceWith('shutdown timed out');
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(dbClose).not.toHaveBeenCalled();
  });
});

describe('unhandled rejections', () => {
  test('are logged by type and never take the service down', async () => {
    await start();
    const handler = handlers.get('unhandledRejection');
    handler?.(new TypeError('password=hunter2'));
    handler?.('plain text with a secret');
    handler?.(undefined);
    expect(mocks.logger.error.mock.calls).toEqual([
      ['unhandled rejection', { reason: 'TypeError' }],
      ['unhandled rejection', { reason: 'string' }],
      ['unhandled rejection', { reason: 'undefined' }],
    ]);
    expect(exit).not.toHaveBeenCalled();
  });
});
