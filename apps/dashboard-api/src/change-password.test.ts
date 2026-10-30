// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { expect, test } from 'vitest';
import { changePasswordBody } from './auth.js';
import { cookieHeader, createTestApp, type TestApp } from './testing/harness.js';
import { describeEnvironments } from './testing/suite.js';

test('changePasswordBody rejects an unchanged password and forces revokeOtherSessions', () => {
  expect(() =>
    changePasswordBody({ currentPassword: 'same-password-1', newPassword: 'same-password-1' }),
  ).toThrow(/must differ/);
  expect(
    changePasswordBody({
      currentPassword: 'old-password-123',
      newPassword: 'new-password-123',
      revokeOtherSessions: false,
    }),
  ).toEqual({
    context: {
      body: {
        currentPassword: 'old-password-123',
        newPassword: 'new-password-123',
        revokeOtherSessions: true,
      },
    },
  });
  // Not an object, or fields that are not both strings: left to Better Auth's own validation.
  expect(changePasswordBody(undefined)).toBeUndefined();
  expect(changePasswordBody('x')).toBeUndefined();
  expect(changePasswordBody({ currentPassword: 1, newPassword: 1 })).toEqual({
    context: { body: { currentPassword: 1, newPassword: 1, revokeOtherSessions: true } },
  });
});

describeEnvironments('change-password server rules', ({ env }) => {
  const mustChange = async (t: TestApp, cookie: string) =>
    (
      (await (await t.request('GET', '/api/me', { cookie })).json()) as {
        mustChangePassword: boolean;
      }
    ).mustChangePassword;

  test('the one-time password cannot be "changed" to itself, and the flag stays set', async () => {
    const t = createTestApp(env());
    try {
      const fresh = await t.createUser({ label: 'same-pw', mustChangePassword: true });
      const cookie = await t.signIn(fresh);

      const response = await t.request('POST', '/api/auth/change-password', {
        cookie,
        json: {
          currentPassword: fresh.password,
          newPassword: fresh.password,
          revokeOtherSessions: true,
        },
        ip: t.nextIp(),
      });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { code?: string }).code).toBe('PASSWORD_UNCHANGED');

      expect(await mustChange(t, cookie)).toBe(true);
      // The password is unchanged, so the one-time password still signs in.
      expect(await t.signIn(fresh)).not.toBe('');
    } finally {
      await t.close();
    }
  });

  test('other sessions are revoked even when the client omits or disables revokeOtherSessions', async () => {
    const t = createTestApp(env());
    try {
      const user = await t.createUser({ label: 'revoke', mustChangePassword: true });
      const stolen = await t.signIn(user);
      const own = await t.signIn(user);

      const response = await t.request('POST', '/api/auth/change-password', {
        cookie: own,
        json: {
          currentPassword: user.password,
          newPassword: 'a-brand-new-password-9',
          revokeOtherSessions: false,
        },
        ip: t.nextIp(),
      });
      expect(response.status).toBe(200);
      const fresh = cookieHeader(response);
      expect(fresh).not.toBe('');

      expect((await t.request('GET', '/api/me', { cookie: stolen })).status).toBe(401);
      expect(await mustChange(t, fresh)).toBe(false);
    } finally {
      await t.close();
    }
  });

  test('a body without revokeOtherSessions also revokes the other sessions', async () => {
    const t = createTestApp(env());
    try {
      const user = await t.createUser({ label: 'revoke-omitted' });
      const other = await t.signIn(user);
      const own = await t.signIn(user);

      const response = await t.request('POST', '/api/auth/change-password', {
        cookie: own,
        json: { currentPassword: user.password, newPassword: 'another-new-password-9' },
        ip: t.nextIp(),
      });
      expect(response.status).toBe(200);
      expect((await t.request('GET', '/api/me', { cookie: other })).status).toBe(401);
      expect((await t.request('GET', '/api/me', { cookie: cookieHeader(response) })).status).toBe(
        200,
      );
    } finally {
      await t.close();
    }
  });
});
