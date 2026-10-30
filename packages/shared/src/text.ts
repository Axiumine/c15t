// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { z } from 'zod';

const NUL = '\u0000';

export const NO_NUL_MESSAGE = 'Must not contain the NUL character (U+0000)';

export function hasNoNul(value: string): boolean {
  return !value.includes(NUL);
}

/**
 * Postgres text cannot hold U+0000 (SQLSTATE 22021), so a string that reaches a query or an
 * insert must not carry it. Apply to every free-text schema that is not already a pattern.
 */
export function noNul<S extends z.ZodString>(schema: S): S {
  return schema.refine(hasNoNul, NO_NUL_MESSAGE);
}

/**
 * Smallest and largest instant that Postgres `timestamp` accepts in the text form JavaScript
 * writes (`0001-01-01 ...` to `9999-12-31 ...`). Year 0000 and years above 9999 are rejected by
 * the database (SQLSTATE 22008/22009), so they are rejected here first.
 */
export const MIN_INSTANT_MS = Date.parse('0001-01-01T00:00:00.000Z');
export const MAX_INSTANT_MS = Date.parse('9999-12-31T23:59:59.999Z');

export function isRepresentableInstant(ms: number): boolean {
  return Number.isFinite(ms) && ms >= MIN_INSTANT_MS && ms <= MAX_INSTANT_MS;
}
