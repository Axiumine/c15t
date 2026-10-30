// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Page } from '@consent/shared';
import type { z } from 'zod';
import { HttpError } from './errors.js';

/*
 * Cursors are opaque to clients: base64url(JSON) of the sort key of the last row. The server
 * validates the decoded shape, so a forged cursor can only produce a 400, never a different query.
 */

export function encodeCursor(payload: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor<S extends z.ZodType>(
  cursor: string | undefined,
  schema: S,
): z.output<S> | undefined {
  if (cursor === undefined) return undefined;
  const invalid = () => new HttpError('BAD_REQUEST', 'Invalid cursor');
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw invalid();
  return parsed.data;
}

/**
 * Queries ask for `limit + 1` rows. The extra row only proves that another page exists, and
 * the cursor is built from the last row that is returned.
 */
export function toPage<Row, Item>(
  rows: readonly Row[],
  limit: number,
  toItem: (row: Row) => Item,
  cursorOf: (row: Row) => string,
): Page<Item> {
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  const hasMore = rows.length > limit && last !== undefined;
  return { items: pageRows.map(toItem), nextCursor: hasMore ? cursorOf(last) : null };
}
