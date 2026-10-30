// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { z } from 'zod';

/** Every `error.code` the platform can return. Keep the status map below in step. */
export const ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'PASSWORD_CHANGE_REQUIRED',
  'NOT_FOUND',
  'CONFLICT',
  'SITE_KEY_TAKEN',
  'EMAIL_TAKEN',
  'LAST_ADMIN',
  'SUBJECT_CONFLICT',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;
export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 500 | 503;

export const ERROR_STATUS: Readonly<Record<ErrorCode, ErrorStatus>> = {
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  PASSWORD_CHANGE_REQUIRED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  SITE_KEY_TAKEN: 409,
  EMAIL_TAKEN: 409,
  LAST_ADMIN: 409,
  // Passed through from c15t when a subject ID belongs to another tenant. Expected, not a bug.
  SUBJECT_CONFLICT: 409,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export const issueSchema = z.object({ path: z.string(), message: z.string() });
export type Issue = z.infer<typeof issueSchema>;

/** `{ error: { code, message } }`. `issues` carries field errors for VALIDATION_ERROR only. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    issues: z.array(issueSchema).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** Never put SQL, stack traces or upstream error text in `message`. */
export function apiError(code: ErrorCode, message: string, issues?: readonly Issue[]): ApiError {
  return {
    error: { code, message, ...(issues === undefined ? {} : { issues: [...issues] }) },
  };
}

/** Flattens a zod error into the `issues` shape without leaking the input values. */
export function issuesFromZod(error: z.ZodError): Issue[] {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}
