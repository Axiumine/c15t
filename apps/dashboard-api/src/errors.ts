// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { ERROR_STATUS, type ErrorCode, type ErrorStatus, type Issue } from '@consent/shared';
import type { Context, Env } from 'hono';
import type { Input } from 'hono/types';

/** Thrown by routes and guards. The error handler turns it into `{ error: { code, message } }`. */
export class HttpError extends Error {
  readonly code: ErrorCode;
  readonly status: ErrorStatus;
  readonly issues: readonly Issue[] | undefined;

  constructor(code: ErrorCode, message: string, issues?: readonly Issue[]) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
    // eslint-disable-next-line security/detect-object-injection -- code is the closed ErrorCode union
    this.status = ERROR_STATUS[code];
    this.issues = issues;
  }
}

export const notFound = (message = 'Not found') => new HttpError('NOT_FOUND', message);

/** Hono's bare `Context` leaves its env, route path and input as `any`: handlers use this instead. */
export type RequestContext<E extends Env = Env> = Context<E, string, Input>;
