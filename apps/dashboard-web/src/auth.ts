// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { type ChangePasswordInput, changePasswordSchema, type LoginInput } from '@consent/shared';
import { createAuthClient } from 'better-auth/react';

/*
 * dashboard-api exposes four Better Auth endpoints over HTTP: sign-in/email, sign-out,
 * get-session and change-password. Everything else under /api/auth answers 404, and admin actions
 * go through /api/admin/* (see api.ts). That is why the admin plugin's client is not added: its
 * methods would call endpoints that do not exist here. Role and mustChangePassword come from
 * GET /api/me.
 */
const AUTH_BASE_PATH = '/api/auth';

const authClient = createAuthClient({
  baseURL: globalThis.location.origin,
  basePath: AUTH_BASE_PATH,
  fetchOptions: {
    credentials: 'include',
    // Resolved per call, so tests can swap the global fetch.
    customFetchImpl: (input, init) => globalThis.fetch(input, init),
  },
});

type AuthFailureKind =
  | 'invalid-credentials'
  | 'wrong-password'
  | 'disabled'
  | 'origin-rejected'
  | 'rate-limited'
  | 'session-ended'
  | 'unavailable'
  | 'unknown';

interface AuthFailure {
  readonly kind: AuthFailureKind;
  readonly message: string;
}

export type AuthResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly failure: AuthFailure };

const OK: AuthResult = { ok: true };
const fail = (kind: AuthFailureKind, message: string): AuthResult => ({
  ok: false,
  failure: { kind, message },
});

interface BetterAuthError {
  readonly status: number;
  readonly code?: string | undefined;
}

/** The `code` of Better Auth's own error body (`{ code, message }`), when there is one. */
function authErrorCode(error: BetterAuthError): string | undefined {
  return typeof error.code === 'string' ? error.code : undefined;
}

/**
 * A 403 on sign-in has two causes. A banned account answers with Better Auth's own
 * `{ code: 'BANNED_USER' }` body, and only after the password was verified. The CSRF origin
 * check of dashboard-api answers `{ error: { code: 'FORBIDDEN' } }` before any password is
 * looked at, so every user sees it when the page was opened from an address other than
 * BETTER_AUTH_URL. The client spreads the response body onto the error object.
 */
function isBannedAccount(error: BetterAuthError): boolean {
  return authErrorCode(error) === 'BANNED_USER';
}

function signInError(error: BetterAuthError): AuthResult {
  if (error.status !== 403) return fail('invalid-credentials', 'Incorrect email or password.');
  return isBannedAccount(error)
    ? fail('disabled', 'This account is disabled. Contact an administrator.')
    : fail(
        'origin-rejected',
        "Sign-in was rejected: this address is not the dashboard's official address. Open the dashboard at its official URL and try again. If you already did, ask an administrator to check that BETTER_AUTH_URL matches it.",
      );
}

function passwordError(error: BetterAuthError): AuthResult {
  if (error.status === 401) return fail('session-ended', 'Your session has ended. Sign in again.');
  if (error.code === 'INVALID_PASSWORD') {
    return fail('wrong-password', 'The current password is not correct.');
  }
  return fail('unknown', 'The password could not be changed. Check the values and try again.');
}

/** Fixed texts: Better Auth's own messages are not shown, and never distinguish "no such user". */
export function describeAuthError(
  error: BetterAuthError,
  context: 'sign-in' | 'password',
): AuthResult {
  if (error.status === 429) {
    return fail('rate-limited', 'Too many attempts. Wait a few minutes and try again.');
  }
  if (error.status >= 500 || error.status === 0) {
    return fail('unavailable', 'The service is temporarily unavailable. Try again in a moment.');
  }
  return context === 'sign-in' ? signInError(error) : passwordError(error);
}

const UNREACHABLE: BetterAuthError = { status: 0 };

export async function signIn(input: LoginInput): Promise<AuthResult> {
  try {
    const { error } = await authClient.signIn.email({
      email: input.email,
      password: input.password,
    });
    return error === null ? OK : describeAuthError(error, 'sign-in');
  } catch {
    return describeAuthError(UNREACHABLE, 'sign-in');
  }
}

export async function signOut(): Promise<void> {
  try {
    await authClient.signOut();
  } catch {
    // The caller clears local state and shows the login screen either way.
  }
}

export async function changePassword(input: ChangePasswordInput): Promise<AuthResult> {
  // Same schema as the form: the "differs from the current password" rule lives in @consent/shared.
  const body = changePasswordSchema.parse(input);
  try {
    const { error } = await authClient.changePassword(body);
    return error === null ? OK : describeAuthError(error, 'password');
  } catch {
    return describeAuthError(UNREACHABLE, 'password');
  }
}
