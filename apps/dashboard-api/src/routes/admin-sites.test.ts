// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { SiteRow } from '@consent/db';
import { apiErrorSchema } from '@consent/shared';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { expect, test } from 'vitest';
import type { AuthedEnv } from '../authz.js';
import { createErrorHandler } from '../errors.js';
import { createLogger } from '../logger.js';
import { adminSiteRoutes } from './admin-sites.js';

const existing: SiteRow = {
  id: '00000000-0000-4000-8000-000000000001',
  key: 'stub-site',
  name: 'Stub site',
  domains: ['stub.example.test'],
  policyPreset: 'eu-opt-in',
  status: 'active',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

/**
 * Admin site routes on a database that accepts every statement but returns no row from an
 * INSERT or UPDATE ... RETURNING. `select ... for update` finds the site `existing`.
 * `statements` lists what the transaction ran, in order.
 */
function setup() {
  const statements: string[] = [];
  const logged: string[] = [];
  const rows = (name: string, result: readonly unknown[]): unknown => {
    statements.push(name);
    const chain: unknown = new Proxy(() => undefined, {
      get: (_target, property) =>
        property === 'then' ? (resolve: (value: unknown) => void) => resolve(result) : () => chain,
    });
    return chain;
  };
  const tx = {
    insert: () => rows('insert', []),
    update: () => rows('update', []),
    select: () => rows('select', [existing]),
    execute: () => rows('execute', []),
  };
  const db = {
    primary: tx,
    transaction: async <T>(run: (executor: typeof tx) => Promise<T>) => run(tx),
  };
  const authz = {
    requireAdmin: createMiddleware<AuthedEnv>(async (c, next) => {
      c.set('user', {
        id: 'admin-1',
        name: 'Admin',
        email: 'admin@example.test',
        role: 'admin',
        mustChangePassword: false,
      });
      await next();
    }),
  };
  const app = new Hono()
    .route('/sites', adminSiteRoutes({ db: db as never, authz }))
    .onError(createErrorHandler(createLogger((line) => logged.push(line))));
  return { app, statements, logged };
}

const json = (body: unknown): RequestInit => ({
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('a site INSERT that returns no row fails the request and writes no audit row', async () => {
  const { app, statements, logged } = setup();
  const response = await app.request('/sites', {
    method: 'POST',
    ...json({ key: 'new-site', name: 'New site', domains: ['new.example.test'] }),
  });
  expect(response.status).toBe(500);
  expect(apiErrorSchema.parse(await response.json()).error.code).toBe('INTERNAL_ERROR');
  // Only the site insert ran: the audit insert after it did not, and the transaction was aborted.
  expect(statements).toEqual(['insert']);
  expect(logged.join('\n')).toContain('insert returned no row');
});

test('a site UPDATE that returns no row fails the request and writes no audit row', async () => {
  const { app, statements, logged } = setup();
  const response = await app.request('/sites/stub-site', {
    method: 'PATCH',
    ...json({ name: 'Renamed' }),
  });
  expect(response.status).toBe(500);
  expect(apiErrorSchema.parse(await response.json()).error.code).toBe('INTERNAL_ERROR');
  expect(statements).toEqual(['select', 'update']);
  expect(logged.join('\n')).toContain('update returned no row');
});
