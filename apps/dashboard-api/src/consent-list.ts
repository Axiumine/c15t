// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Database } from '@consent/db';
import type { ConsentPage, ConsentRecord } from '@consent/shared';
import type { TenantScope } from './authz-types.js';
import { type ConsentCursor, consentCursorSchema } from './consent-cursor.js';
import type { ConsentFilters } from './consent-filters.js';
import { toConsentRecord } from './consent-record.js';
import { type ConsentRow, fetchRows, purposeCodes } from './consent-rows.js';
import { decodeCursor, encodeCursor, toPage } from './pagination.js';

const EXPORT_BATCH_SIZE = 500;

const cursorOf = (row: ConsentRow) => encodeCursor({ g: row.givenAt, i: row.id });

export async function listConsents(
  db: Database,
  scope: TenantScope,
  filters: ConsentFilters,
  page: { cursor?: string | undefined; limit: number },
): Promise<ConsentPage> {
  const after = decodeCursor(page.cursor, consentCursorSchema);
  const [rows, codes] = await Promise.all([
    fetchRows(db, { scope, filters, after, limit: page.limit + 1 }),
    purposeCodes(db, scope),
  ]);
  return toPage(rows, page.limit, (row) => toConsentRecord(row, codes), cursorOf);
}

/**
 * Keyset-paginated batches, newest first. Only one batch is in memory at a time: the caller
 * pulls the next batch when it has written the previous one.
 */
export async function* consentBatches(
  db: Database,
  scope: TenantScope,
  filters: ConsentFilters,
  batchSize = EXPORT_BATCH_SIZE,
): AsyncGenerator<ConsentRecord[], void, undefined> {
  const codes = await purposeCodes(db, scope);
  let after: ConsentCursor | undefined;
  for (;;) {
    const rows = await fetchRows(db, { scope, filters, after, limit: batchSize });
    if (rows.length > 0) yield rows.map((row) => toConsentRecord(row, codes));
    const last = rows.at(-1);
    if (rows.length < batchSize || last === undefined) return;
    after = { g: last.givenAt, i: last.id };
  }
}
