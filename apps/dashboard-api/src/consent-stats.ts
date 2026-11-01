// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Database } from '@consent/db';
import type { StatsResponse } from '@consent/shared';
import { and, desc, gte, lt, type SQL, sql } from 'drizzle-orm';
import type { TenantScope } from './authz-types.js';
import { inScope } from './consent-filters.js';
import { purposeStats, withOptInRate } from './consent-purpose-stats.js';
import { consent } from './consent-tables.js';
import { type StatsRange, startOfUtcDay, toNaiveUtc } from './range.js';

const count = sql<number>`count(*)`.mapWith(Number);

function rangeConditions(scope: TenantScope, range: StatsRange): SQL | undefined {
  return and(
    inScope(scope),
    gte(consent.givenAt, toNaiveUtc(range.from)),
    lt(consent.givenAt, toNaiveUtc(range.to)),
  );
}

function zeroFilledDays(range: StatsRange, counts: ReadonlyMap<string, number>) {
  const days: { date: string; consents: number }[] = [];
  const last = new Date(range.to.getTime() - 1);
  for (
    let day = startOfUtcDay(range.from);
    day <= last;
    day = new Date(day.getTime() + 86_400_000)
  ) {
    const date = day.toISOString().slice(0, 10);
    days.push({ date, consents: counts.get(date) ?? 0 });
  }
  return days;
}

export async function consentStats(
  db: Database,
  scope: TenantScope,
  range: StatsRange,
): Promise<StatsResponse> {
  const where = rangeConditions(scope, range);
  const day = sql<string>`to_char(${consent.givenAt}, 'YYYY-MM-DD')`;
  const jurisdiction = sql<string>`coalesce(${consent.jurisdiction}, 'unknown')`;

  const [totals, volume, purposes, jurisdictions] = await Promise.all([
    db
      .select({
        consents: count,
        subjects: sql<number>`count(distinct ${consent.subjectId})`.mapWith(Number),
      })
      .from(consent)
      .where(where),
    db.select({ date: day, consents: count }).from(consent).where(where).groupBy(day).orderBy(day),
    purposeStats(db, where),
    db
      .select({ jurisdiction, consents: count })
      .from(consent)
      .where(where)
      .groupBy(jurisdiction)
      .orderBy(desc(count), jurisdiction),
  ]);

  const total = totals[0] ?? { consents: 0, subjects: 0 };
  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    totals: { consents: total.consents, subjects: total.subjects },
    volume: zeroFilledDays(range, new Map(volume.map((row) => [row.date, row.consents]))),
    purposes: purposes.map(withOptInRate),
    jurisdictions,
  };
}
