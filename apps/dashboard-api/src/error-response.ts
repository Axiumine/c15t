// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { type ApiError, apiError, ERROR_STATUS, type ErrorCode, type Issue } from '@consent/shared';
import type { RequestContext } from './errors.js';

/** Fixed text per code: upstream messages (Better Auth, drivers) never reach the client. */
const SAFE_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  BAD_REQUEST: 'The request could not be processed',
  VALIDATION_ERROR: 'The request is invalid',
  UNAUTHORIZED: 'Authentication is required',
  FORBIDDEN: 'You are not allowed to do this',
  PASSWORD_CHANGE_REQUIRED: 'You must change your password before continuing',
  NOT_FOUND: 'Not found',
  CONFLICT: 'The request conflicts with the current state',
  SITE_KEY_TAKEN: 'A site with this key already exists',
  EMAIL_TAKEN: 'A user with this email already exists',
  LAST_ADMIN: 'At least one active administrator must remain',
  SUBJECT_CONFLICT: 'The subject belongs to another site',
  RATE_LIMITED: 'Too many requests, try again later',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable',
  INTERNAL_ERROR: 'Internal server error',
};

function errorBody(code: ErrorCode, message?: string, issues?: readonly Issue[]): ApiError {
  // eslint-disable-next-line security/detect-object-injection -- code is the closed ErrorCode union
  return apiError(code, message ?? SAFE_MESSAGES[code], issues);
}

export function errorResponse(
  c: RequestContext,
  code: ErrorCode,
  message?: string,
  issues?: readonly Issue[],
): Response {
  // eslint-disable-next-line security/detect-object-injection -- code is the closed ErrorCode union
  return c.json(errorBody(code, message, issues), ERROR_STATUS[code]);
}
