// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { dbErrorCode, isFailoverError } from '@consent/db';
import {
  type ApiError,
  apiError,
  ERROR_STATUS,
  type ErrorCode,
  type ErrorStatus,
  type Issue,
} from '@consent/shared';
import { isAPIError } from 'better-auth/api';
import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { describeError, type Logger } from './logger.js';

/** Thrown by routes and guards. The error handler turns it into `{ error: { code, message } }`. */
export class HttpError extends Error {
  readonly code: ErrorCode;
  readonly status: ErrorStatus;
  readonly issues: readonly Issue[] | undefined;

  constructor(code: ErrorCode, message: string, issues?: readonly Issue[]) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.issues = issues;
  }
}

export const notFound = (message = 'Not found') => new HttpError('NOT_FOUND', message);

const STATUS_TO_CODE: Readonly<Record<number, ErrorCode>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'BAD_REQUEST',
  429: 'RATE_LIMITED',
};

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

export function errorBody(code: ErrorCode, message?: string, issues?: readonly Issue[]): ApiError {
  return apiError(code, message ?? SAFE_MESSAGES[code], issues);
}

export function errorResponse(
  c: Context,
  code: ErrorCode,
  message?: string,
  issues?: readonly Issue[],
): Response {
  return c.json(errorBody(code, message, issues), ERROR_STATUS[code]);
}

/**
 * SQLSTATE class 22 (data exception): a value the database cannot store or compare, such as a
 * date out of range (22008) or a NUL byte (22021). Validation should catch these first. If one
 * slips through, the input was bad, not the server.
 */
const DATA_EXCEPTION = /^22[0-9A-Z]{3}$/;

function classify(error: unknown): {
  code: ErrorCode;
  message?: string;
  issues?: readonly Issue[];
} {
  if (error instanceof HttpError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.issues ? { issues: error.issues } : {}),
    };
  }
  if (isFailoverError(error)) return { code: 'SERVICE_UNAVAILABLE' };
  if (DATA_EXCEPTION.test(dbErrorCode(error) ?? '')) return { code: 'VALIDATION_ERROR' };
  if (isAPIError(error)) return { code: STATUS_TO_CODE[error.statusCode] ?? 'INTERNAL_ERROR' };
  if (error instanceof HTTPException)
    return { code: STATUS_TO_CODE[error.status] ?? 'INTERNAL_ERROR' };
  return { code: 'INTERNAL_ERROR' };
}

export function createErrorHandler(logger: Logger): ErrorHandler {
  return (error, c) => {
    const { code, message, issues } = classify(error);
    if (code === 'INTERNAL_ERROR') {
      logger.error('unhandled error', {
        method: c.req.method,
        path: c.req.path,
        ...describeError(error),
      });
    } else if (code === 'SERVICE_UNAVAILABLE') {
      logger.warn('database unavailable (failover?)', {
        path: c.req.path,
        ...describeError(error),
      });
    }
    return errorResponse(c, code, message, issues);
  };
}

export const notFoundHandler: NotFoundHandler = (c) => errorResponse(c, 'NOT_FOUND');
