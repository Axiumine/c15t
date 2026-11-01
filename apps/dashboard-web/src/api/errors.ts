// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { ErrorCode, Issue } from '@consent/shared';

/* ---------------------------------------------------------------------------------------------
 * Errors. dashboard-api answers `{ error: { code, message } }`; nginx and Cloudflare can answer
 * with other bodies (a plain 502, an HTML page), so the status decides the kind first.
 * ------------------------------------------------------------------------------------------- */

export type ApiErrorKind =
  | 'unauthorized'
  | 'password-change-required'
  | 'forbidden'
  | 'not-found'
  | 'validation'
  | 'conflict'
  | 'rate-limited'
  | 'unavailable'
  | 'network'
  | 'unknown';

export interface ApiErrorInit {
  readonly status: number;
  readonly code?: ErrorCode | undefined;
  readonly message?: string | undefined;
  readonly issues?: readonly Issue[] | undefined;
  readonly kind?: ApiErrorKind | undefined;
}

const UNAVAILABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

const KIND_BY_STATUS: ReadonlyMap<number, ApiErrorKind> = new Map<number, ApiErrorKind>([
  [401, 'unauthorized'],
  [403, 'forbidden'],
  [404, 'not-found'],
  [429, 'rate-limited'],
  [409, 'conflict'],
  [400, 'validation'],
]);

function classify(status: number, code: ErrorCode | undefined): ApiErrorKind {
  if (code === 'PASSWORD_CHANGE_REQUIRED') return 'password-change-required';
  if (code === 'SERVICE_UNAVAILABLE' || UNAVAILABLE_STATUSES.has(status)) return 'unavailable';
  return KIND_BY_STATUS.get(status) ?? 'unknown';
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | undefined;
  readonly kind: ApiErrorKind;
  readonly issues: readonly Issue[];

  constructor(init: ApiErrorInit) {
    super(init.message ?? `Request failed (${init.status})`);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.kind = init.kind ?? classify(init.status, init.code);
    this.issues = init.issues ?? [];
  }
}
