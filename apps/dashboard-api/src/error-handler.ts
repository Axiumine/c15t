// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { dbErrorCode, isFailoverError } from '@consent/db';
import type { ErrorCode, Issue } from '@consent/shared';
import { isAPIError } from 'better-auth/api';
import { HTTPException } from 'hono/http-exception';
import { errorResponse } from './error-response.js';
import { HttpError, type RequestContext } from './errors.js';
import { describeError, type Logger } from './logger.js';

const STATUS_TO_CODE: ReadonlyMap<number, ErrorCode> = new Map([
  [400, 'BAD_REQUEST'],
  [401, 'UNAUTHORIZED'],
  [403, 'FORBIDDEN'],
  [404, 'NOT_FOUND'],
  [409, 'CONFLICT'],
  [413, 'BAD_REQUEST'],
  [429, 'RATE_LIMITED'],
]);

/**
 * SQLSTATE class 22 (data exception): a value the database cannot store or compare, such as a
 * date out of range (22008) or a NUL byte (22021). Validation should catch these first. If one
 * slips through, the input was bad, not the server.
 */
const DATA_EXCEPTION = /^22[0-9A-Z]{3}$/;

interface Classified {
  code: ErrorCode;
  message?: string;
  issues?: readonly Issue[];
}

const classifyHttpError = (error: HttpError): Classified => ({
  code: error.code,
  message: error.message,
  ...(error.issues ? { issues: error.issues } : {}),
});

/** The platform code for an HTTP status from Better Auth or Hono. */
const codeForStatus = (status: number): ErrorCode => STATUS_TO_CODE.get(status) ?? 'INTERNAL_ERROR';

function classify(error: unknown): Classified {
  if (error instanceof HttpError) return classifyHttpError(error);
  if (isFailoverError(error)) return { code: 'SERVICE_UNAVAILABLE' };
  if (DATA_EXCEPTION.test(dbErrorCode(error) ?? '')) return { code: 'VALIDATION_ERROR' };
  if (isAPIError(error)) return { code: codeForStatus(error.statusCode) };
  if (error instanceof HTTPException) return { code: codeForStatus(error.status) };
  return { code: 'INTERNAL_ERROR' };
}

export function createErrorHandler(logger: Logger) {
  return (error: Error, c: RequestContext): Response => {
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

export const notFoundHandler = (c: RequestContext): Response => errorResponse(c, 'NOT_FOUND');
