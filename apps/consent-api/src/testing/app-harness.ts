// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

/* The app under test, wired to in-memory fakes: shared by the app.*.test.ts files. */

import type { HttpBindings } from '@hono/node-server';
import type { Hono } from 'hono';
import { createApp } from '../app.js';
import type { AppEnv } from '../app-types.js';
import { SiteRegistry } from '../registry.js';
import type { InstanceFactory } from '../registry-types.js';
import {
  capturingLogger,
  type FakeInstance,
  fakeInstance,
  MemoryStore,
  type siteRecord,
} from './fakes.js';

export const TRUSTED = ['127.0.0.1/32', '::1/128'];
export const LOOPBACK = '127.0.0.1';
export const LAN = '192.168.1.50';

export function bindings(target: string, peer: string | null): HttpBindings | undefined {
  if (peer === null) return undefined;
  return { incoming: { url: target, socket: { remoteAddress: peer } } } as unknown as HttpBindings;
}

export interface Harness {
  readonly app: Hono<AppEnv>;
  readonly registry: SiteRegistry;
  readonly store: MemoryStore;
  readonly instances: Map<string, FakeInstance[]>;
  readonly logger: ReturnType<typeof capturingLogger>;
  readonly advance: (ms: number) => void;
  /** Overrides what instances of one site answer, for the next ones built. */
  readonly respondWith: (
    key: string,
    respond: (request: Request, built: number) => Response | Promise<Response>,
  ) => void;
  readonly send: (
    target: string,
    init?: RequestInit,
    /** `null`: no socket behind the request. */
    peer?: string | null,
  ) => Promise<Response>;
}

export function harness(...records: ReturnType<typeof siteRecord>[]): Harness {
  const store = new MemoryStore(...records);
  const instances = new Map<string, FakeInstance[]>();
  const responders = new Map<
    string,
    (request: Request, built: number) => Response | Promise<Response>
  >();
  const factory: InstanceFactory = (site) => {
    const list = instances.get(site.key) ?? [];
    instances.set(site.key, list);
    const built = list.length;
    const instance = fakeInstance((request) => {
      const respond = responders.get(site.key);
      return respond === undefined ? Response.json({ site: site.key }) : respond(request, built);
    });
    list.push(instance);
    return instance;
  };
  let clock = 5_000_000;
  const logger = capturingLogger();
  const registry = new SiteRegistry({
    store,
    factory,
    logger,
    evictCooldownMs: 5_000,
    drainMs: 100,
    now: () => clock,
  });
  const app = createApp({
    registry,
    trustedProxies: TRUSTED,
    readiness: () => store.check(),
    listenerState: () => 'listening',
    logger,
  });
  return {
    app,
    registry,
    store,
    instances,
    logger,
    advance: (ms) => {
      clock += ms;
    },
    respondWith: (key, respond) => {
      responders.set(key, respond);
    },
    send: (target, init, peer = LOOPBACK) => {
      return Promise.resolve(app.request(target, init, bindings(target, peer)));
    },
  };
}

export function lastRequest(h: Harness, key: string): Request {
  const request = h.instances.get(key)?.at(-1)?.requests.at(-1);
  if (request === undefined) throw new Error(`site ${key} received no request`);
  return request;
}

export function callCount(h: Harness, key: string): number {
  return (h.instances.get(key) ?? []).reduce((sum, instance) => sum + instance.requests.length, 0);
}

export interface ErrorBody {
  error: { code: string; message: string };
}

export const errorBody = async (response: Response): Promise<ErrorBody> =>
  (await response.json()) as ErrorBody;

export const databaseFailure = () =>
  Response.json(
    { cause: { code: 'DATABASE_ERROR' }, message: 'Internal server error' },
    { status: 500 },
  );
