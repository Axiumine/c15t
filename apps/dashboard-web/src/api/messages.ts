// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Issue } from '@consent/shared';
import { ApiError, type ApiErrorKind } from './errors';

const FRIENDLY: Readonly<Record<ApiErrorKind, string>> = {
  unauthorized: 'Your session has ended. Sign in again.',
  'password-change-required': 'You must change your password before continuing.',
  forbidden: 'You are not allowed to do this.',
  'not-found': 'This could not be found.',
  validation: 'Some of the values are not valid.',
  conflict: 'This conflicts with the current state.',
  'rate-limited': 'Too many requests. Wait a moment and try again.',
  unavailable: 'The service is temporarily unavailable. Try again in a moment.',
  network: 'Cannot reach the server. Check your connection and try again.',
  unknown: 'Something went wrong. Try again.',
};

/** Text that is safe to show: server messages only for codes where the user can act on them. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return FRIENDLY.unknown;
  const specific =
    error.kind === 'validation' || error.kind === 'conflict' || error.kind === 'forbidden';
  return specific && error.message !== '' && error.code !== undefined
    ? error.message
    : FRIENDLY[error.kind];
}

export const isUnavailable = (error: unknown): boolean =>
  error instanceof ApiError && (error.kind === 'unavailable' || error.kind === 'network');

/** Field errors by path, for pushing a server-side VALIDATION_ERROR back into a form. */
export function fieldIssues(error: unknown): readonly Issue[] {
  return error instanceof ApiError ? error.issues : [];
}
