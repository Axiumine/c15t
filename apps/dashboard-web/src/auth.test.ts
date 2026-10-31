// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { expect, test } from 'vitest';
import { changePassword, describeAuthError, signIn, signOut } from './auth';
import { apiError, json, mockFetch, route } from './test/harness';

const credentials = { email: 'una@example.com', password: 'correct horse battery' };
const passwords = {
  currentPassword: 'correct horse battery',
  newPassword: 'another long passphrase',
};

function kindOf(result: Awaited<ReturnType<typeof signIn>>): string {
  return result.ok ? 'ok' : result.failure.kind;
}

test('a 429 is rate-limited in both contexts', () => {
  for (const context of ['sign-in', 'password'] as const) {
    expect(describeAuthError({ status: 429 }, context)).toMatchObject({
      ok: false,
      failure: { kind: 'rate-limited' },
    });
  }
});

test('a server error or no response at all is "unavailable", never "wrong password"', () => {
  for (const status of [0, 500, 502, 503]) {
    expect(describeAuthError({ status }, 'sign-in')).toMatchObject({
      ok: false,
      failure: {
        kind: 'unavailable',
        message: 'The service is temporarily unavailable. Try again in a moment.',
      },
    });
    expect(kindOf(describeAuthError({ status }, 'password'))).toBe('unavailable');
  }
});

test('on sign-in, a banned account is told apart from the CSRF origin check', () => {
  expect(describeAuthError({ status: 403, code: 'BANNED_USER' }, 'sign-in')).toMatchObject({
    failure: { kind: 'disabled' },
  });
  expect(describeAuthError({ status: 403 }, 'sign-in')).toMatchObject({
    failure: { kind: 'origin-rejected' },
  });
  // A body code that is not a string is no banned-account marker.
  expect(kindOf(describeAuthError({ status: 403, code: 7 as unknown as string }, 'sign-in'))).toBe(
    'origin-rejected',
  );
});

test('any other sign-in failure gets the same text as an unknown user', () => {
  const wrong = describeAuthError({ status: 401 }, 'sign-in');
  const unknownUser = describeAuthError(
    { status: 400, code: 'INVALID_EMAIL_OR_PASSWORD' },
    'sign-in',
  );
  expect(wrong).toEqual(unknownUser);
  expect(kindOf(wrong)).toBe('invalid-credentials');
});

test('on a password change, 401 ends the session and INVALID_PASSWORD is the wrong password', () => {
  expect(describeAuthError({ status: 401 }, 'password')).toMatchObject({
    failure: { kind: 'session-ended', message: 'Your session has ended. Sign in again.' },
  });
  expect(describeAuthError({ status: 400, code: 'INVALID_PASSWORD' }, 'password')).toMatchObject({
    failure: { kind: 'wrong-password' },
  });
});

test('any other password-change failure is a generic message that keeps no server text', () => {
  expect(describeAuthError({ status: 400, code: 'SOMETHING_ELSE' }, 'password')).toEqual({
    ok: false,
    failure: {
      kind: 'unknown',
      message: 'The password could not be changed. Check the values and try again.',
    },
  });
  expect(kindOf(describeAuthError({ status: 422 }, 'password'))).toBe('unknown');
});

test('signIn reports success, a rejection, and a connection that throws', async () => {
  mockFetch(route('POST /api/auth/sign-in/email', json({ token: 't', user: { id: 'u' } })));
  expect(await signIn(credentials)).toEqual({ ok: true });

  mockFetch(route('POST /api/auth/sign-in/email', apiError(401, 'UNAUTHORIZED')));
  expect(kindOf(await signIn(credentials))).toBe('invalid-credentials');

  mockFetch(() => {
    throw new TypeError('Failed to fetch');
  });
  expect(await signIn(credentials)).toMatchObject({ ok: false, failure: { kind: 'unavailable' } });
});

test('changePassword sends the checked values, and reports a connection that throws', async () => {
  const { calls } = mockFetch(route('POST /api/auth/change-password', json({ token: 't' })));
  expect(await changePassword(passwords)).toEqual({ ok: true });
  expect(calls[0]?.body).toMatchObject({
    currentPassword: passwords.currentPassword,
    newPassword: passwords.newPassword,
  });

  mockFetch(route('POST /api/auth/change-password', json({ code: 'INVALID_PASSWORD' }, 400)));
  expect(kindOf(await changePassword(passwords))).toBe('wrong-password');

  mockFetch(() => {
    throw new TypeError('Failed to fetch');
  });
  expect(kindOf(await changePassword(passwords))).toBe('unavailable');
});

test('changePassword refuses a new password equal to the current one before any request', async () => {
  const { calls } = mockFetch();
  await expect(
    changePassword({ ...passwords, newPassword: passwords.currentPassword }),
  ).rejects.toThrow();
  expect(calls).toHaveLength(0);
});

test('signOut calls the endpoint and swallows a failing connection', async () => {
  const { calls } = mockFetch(route('POST /api/auth/sign-out', json({ success: true })));
  await signOut();
  expect(calls.map((call) => call.url.pathname)).toEqual(['/api/auth/sign-out']);

  mockFetch(() => {
    throw new TypeError('Failed to fetch');
  });
  await expect(signOut()).resolves.toBeUndefined();
});
