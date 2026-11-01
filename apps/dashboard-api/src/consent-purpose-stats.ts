// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Database } from '@consent/db';
import { type SQL, sql } from 'drizzle-orm';
import { consent } from './consent-tables.js';

/** Granted and denied answers per category, from the `choice` receipts. */
export function purposeStats(db: Database, where: SQL | undefined) {
  // Only receipts (`choice`) say what was denied, so older rows are left out of the rates.
  const categories = sql`case when jsonb_typeof(${consent.choice}::jsonb -> 'categories') = 'object' then ${consent.choice}::jsonb -> 'categories' end`;
  return db
    .select({
      purpose: sql<string>`cat.key`,
      granted: sql<number>`count(*) filter (where cat.value ->> 'value' = 'true')`.mapWith(Number),
      denied: sql<number>`count(*) filter (where cat.value ->> 'value' = 'false')`.mapWith(Number),
    })
    .from(sql`${consent}, jsonb_each(${categories}) as cat`)
    .where(where)
    .groupBy(sql`cat.key`)
    .orderBy(sql`cat.key`);
}

type PurposeCount = Awaited<ReturnType<typeof purposeStats>>[number];

/** The share of the answered consents (granted or denied) that were granted. */
export function withOptInRate(row: PurposeCount) {
  const answered = row.granted + row.denied;
  return { ...row, optInRate: answered === 0 ? 0 : row.granted / answered };
}
