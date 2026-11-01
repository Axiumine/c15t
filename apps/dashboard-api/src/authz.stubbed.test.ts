// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { apiErrorSchema } from '@consent/shared';
import { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import type { Auth } from './auth.js';
import { createAuthz } from './authz.js';
import { createErrorHandler } from './error-handler.js';
import { silentLogger } from './logger.js';

/* Guard behaviour with a stubbed session: boundaries and messages that mutation testing showed untested. */
describe('guards with a stubbed session', () => {
  const sessionOf = (user: Record<string, unknown>) => ({
    user: { id: 'u1', name: 'U', email: 'u@example.test', role: 'user', banned: false, ...user },
  });
  const appFor = (user: Record<string, unknown>, now?: () => Date) => {
    const auth = { api: { getSession: async () => sessionOf(user) } } as unknown as Auth;
    const authz = createAuthz({ auth, db: { primary: undefined as never }, ...(now && { now }) });
    return new Hono()
      .get('/session', authz.requireSession, (c) => c.json({ ok: true }))
      .get('/admin', authz.requireAdmin, (c) => c.json({ ok: true }))
      .get('/sites/:siteKey', authz.requireSiteAccess, (c) => c.json({ ok: true }))
      .onError(createErrorHandler(silentLogger));
  };
  const answer = async (response: Response) => ({
    status: response.status,
    error: apiErrorSchema.parse(await response.json()).error,
  });

  test('every guard, including the site one on its own, blocks a user who must change the password', async () => {
    const app = appFor({ mustChangePassword: true });
    for (const path of ['/session', '/sites/any-site']) {
      expect(await answer(await app.request(path)), path).toEqual({
        status: 403,
        error: {
          code: 'PASSWORD_CHANGE_REQUIRED',
          message: 'You must change your password before continuing',
        },
      });
    }
  });

  test('a ban that expires at exactly this instant is over; one more millisecond and it is not', async () => {
    const expiry = new Date('2026-03-01T12:00:00.000Z');
    const at = (instant: Date) => appFor({ banned: true, banExpires: expiry }, () => instant);
    expect((await at(expiry).request('/session')).status).toBe(200);
    expect((await at(new Date(expiry.getTime() - 1)).request('/session')).status).toBe(401);
  });

  test('the answers carry fixed messages', async () => {
    const banned = appFor({ banned: true, banExpires: null });
    expect(await answer(await banned.request('/session'))).toEqual({
      status: 401,
      error: { code: 'UNAUTHORIZED', message: 'This account is disabled' },
    });
    const odd = appFor({ role: 'superuser' });
    expect(await answer(await odd.request('/session'))).toEqual({
      status: 403,
      error: { code: 'FORBIDDEN', message: 'You are not allowed to do this' },
    });
    const user = appFor({});
    expect(await answer(await user.request('/admin'))).toEqual({
      status: 403,
      error: { code: 'FORBIDDEN', message: 'Administrator access is required' },
    });
  });

  test('no session at all is 401 with its own message', async () => {
    const auth = { api: { getSession: async () => null } } as unknown as Auth;
    const authz = createAuthz({ auth, db: { primary: undefined as never } });
    const app = new Hono()
      .get('/session', authz.requireSession, (c) => c.json({ ok: true }))
      .onError(createErrorHandler(silentLogger));
    expect(await answer(await app.request('/session'))).toEqual({
      status: 401,
      error: { code: 'UNAUTHORIZED', message: 'Authentication is required' },
    });
  });
});
