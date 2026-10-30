// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { c15t, type Database } from '@consent/db';
import {
  CONSENT_CSV_COLUMNS,
  type ConsentPage,
  type ConsentRecord,
  isRepresentableInstant,
  noNul,
  type StatsResponse,
} from '@consent/shared';
import { and, desc, eq, gte, inArray, lt, or, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { TenantScope } from './authz.js';
import { csvRow } from './csv.js';
import { decodeCursor, encodeCursor, toPage } from './pagination.js';
import {
  fromNaiveUtc,
  type StatsRange,
  startOfUtcDay,
  type TimeBounds,
  toNaiveUtc,
} from './range.js';

/*
 * Read-only queries over the `c15t` schema (README D4). Rules, in order of importance:
 * 1. Every query filters by `tenantId IN scope.tenantIds`. A `TenantScope` can only come from
 *    authz.ts, never from request input.
 * 2. Related rows (subject, domain, policy decision) are joined on the same tenant.
 * 3. Nothing here writes. The role behind `db.analytics` has SELECT only.
 */

const { consentInC15T: consent, subjectInC15T: subject, domainInC15T: domain } = c15t;
const { runtimePolicyDecisionInC15T: decision, consentPurposeInC15T: purpose } = c15t;

export interface ConsentFilters extends TimeBounds {
  readonly subject?: string | undefined;
}

export const EXPORT_BATCH_SIZE = 500;

/**
 * `YYYY-MM-DD[ T]HH:MM:SS[.ffffff]` that is a real UTC date: the shape check alone lets month 13,
 * 31 February or hour 24 through, and Postgres answers those with an error instead of a 400.
 */
export function isNaiveTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)) return false;
  const seconds = `${value.slice(0, 10)}T${value.slice(11, 19)}`;
  const ms = Date.parse(`${seconds}Z`);
  // Round trip: JavaScript rolls 31 February over to 3 March, so the text must come back as it went in.
  return isRepresentableInstant(ms) && new Date(ms).toISOString().slice(0, 19) === seconds;
}

const naiveTimestamp = z.string().refine(isNaiveTimestamp, 'Not a UTC timestamp');
const consentCursorSchema = z.object({ g: naiveTimestamp, i: noNul(z.string().min(1).max(255)) });
type ConsentCursor = z.output<typeof consentCursorSchema>;

function inScope(scope: TenantScope): SQL {
  // An empty list renders as `false`, so an empty scope returns nothing.
  return inArray(consent.tenantId, [...scope.tenantIds]);
}

function consentConditions(
  scope: TenantScope,
  filters: ConsentFilters,
  after: ConsentCursor | undefined,
): SQL | undefined {
  const conditions: (SQL | undefined)[] = [inScope(scope)];
  if (filters.subject !== undefined) {
    conditions.push(
      or(eq(consent.subjectId, filters.subject), eq(subject.externalId, filters.subject)),
    );
  }
  if (filters.from !== undefined) conditions.push(gte(consent.givenAt, toNaiveUtc(filters.from)));
  if (filters.to !== undefined) conditions.push(lt(consent.givenAt, toNaiveUtc(filters.to)));
  if (after !== undefined) {
    conditions.push(
      or(lt(consent.givenAt, after.g), and(eq(consent.givenAt, after.g), lt(consent.id, after.i))),
    );
  }
  return and(...conditions);
}

async function purposeCodes(db: Database, scope: TenantScope): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: purpose.id, code: purpose.code })
    .from(purpose)
    .where(inArray(purpose.tenantId, [...scope.tenantIds]));
  return new Map(rows.map((row) => [row.id, row.code]));
}

async function fetchRows(
  db: Database,
  scope: TenantScope,
  filters: ConsentFilters,
  after: ConsentCursor | undefined,
  limit: number,
) {
  return db
    .select({
      id: consent.id,
      subjectId: consent.subjectId,
      externalId: subject.externalId,
      domain: domain.name,
      givenAt: consent.givenAt,
      validUntil: consent.validUntil,
      purposeIds: consent.purposeIds,
      choice: consent.choice,
      consentAction: consent.consentAction,
      jurisdiction: consent.jurisdiction,
      jurisdictionModel: consent.jurisdictionModel,
      countryCode: decision.countryCode,
      regionCode: decision.regionCode,
      uiSource: consent.uiSource,
      ipAddress: consent.ipAddress,
      userAgent: consent.userAgent,
    })
    .from(consent)
    .innerJoin(
      subject,
      and(eq(subject.id, consent.subjectId), eq(subject.tenantId, consent.tenantId)),
    )
    .innerJoin(domain, and(eq(domain.id, consent.domainId), eq(domain.tenantId, consent.tenantId)))
    .leftJoin(
      decision,
      and(
        eq(decision.id, consent.runtimePolicyDecisionId),
        eq(decision.tenantId, consent.tenantId),
      ),
    )
    .where(consentConditions(scope, filters, after))
    .orderBy(desc(consent.givenAt), desc(consent.id))
    .limit(limit);
}

type ConsentRow = Awaited<ReturnType<typeof fetchRows>>[number];

/** c15t 2.x wrapped JSON columns as `{ json: ... }`. Unwrap it, and decode double-encoded text. */
function unwrapJson(value: unknown): unknown {
  let current = value;
  if (typeof current === 'string') {
    try {
      current = JSON.parse(current);
    } catch {
      return undefined;
    }
  }
  if (
    typeof current === 'object' &&
    current !== null &&
    !Array.isArray(current) &&
    'json' in current
  ) {
    return unwrapJson((current as { json: unknown }).json);
  }
  return current;
}

function receiptPurposes(choice: unknown): [string, boolean][] {
  const categories = (unwrapJson(choice) as { categories?: unknown } | null | undefined)
    ?.categories;
  if (typeof categories !== 'object' || categories === null) return [];
  const entries: [string, boolean][] = [];
  for (const [name, receipt] of Object.entries(categories)) {
    const granted = (receipt as { value?: unknown } | null)?.value;
    if (typeof granted === 'boolean') entries.push([name, granted]);
  }
  return entries;
}

function grantedCodes(purposeIds: unknown, codesById: ReadonlyMap<string, string>): string[] {
  const ids = unwrapJson(purposeIds);
  if (!Array.isArray(ids)) return [];
  return ids.flatMap((id) => {
    const code = typeof id === 'string' ? codesById.get(id) : undefined;
    return code === undefined ? [] : [code];
  });
}

/**
 * Category code to granted. `choice` (c15t 3.x receipts) says what was granted and what was
 * denied. Older rows only list the granted purpose IDs, which map to codes through `consentPurpose`.
 */
export function derivePurposes(
  choice: unknown,
  purposeIds: unknown,
  codesById: ReadonlyMap<string, string>,
): Record<string, boolean> {
  const purposes = new Map(receiptPurposes(choice));
  for (const code of grantedCodes(purposeIds, codesById)) {
    if (!purposes.has(code)) purposes.set(code, true);
  }
  return Object.fromEntries(purposes);
}

export function toConsentRecord(
  row: ConsentRow,
  codesById: ReadonlyMap<string, string>,
): ConsentRecord {
  return {
    id: row.id,
    subjectId: row.subjectId,
    externalId: row.externalId,
    domain: row.domain,
    givenAt: fromNaiveUtc(row.givenAt),
    validUntil: row.validUntil === null ? null : fromNaiveUtc(row.validUntil),
    purposes: derivePurposes(row.choice, row.purposeIds, codesById),
    consentAction: row.consentAction,
    jurisdiction: row.jurisdiction,
    jurisdictionModel: row.jurisdictionModel,
    countryCode: row.countryCode,
    regionCode: row.regionCode,
    uiSource: row.uiSource,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
  };
}

const cursorOf = (row: ConsentRow) => encodeCursor({ g: row.givenAt, i: row.id });

export async function listConsents(
  db: Database,
  scope: TenantScope,
  filters: ConsentFilters,
  page: { cursor?: string | undefined; limit: number },
): Promise<ConsentPage> {
  const after = decodeCursor(page.cursor, consentCursorSchema);
  const [rows, codes] = await Promise.all([
    fetchRows(db, scope, filters, after, page.limit + 1),
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
): AsyncGenerator<ConsentRecord[]> {
  const codes = await purposeCodes(db, scope);
  let after: ConsentCursor | undefined;
  for (;;) {
    const rows = await fetchRows(db, scope, filters, after, batchSize);
    if (rows.length > 0) yield rows.map((row) => toConsentRecord(row, codes));
    const last = rows.at(-1);
    if (rows.length < batchSize || last === undefined) return;
    after = { g: last.givenAt, i: last.id };
  }
}

export const CSV_HEADER = csvRow(CONSENT_CSV_COLUMNS);

export function consentCsvRow(record: ConsentRecord): string {
  return csvRow(
    CONSENT_CSV_COLUMNS.map((column) =>
      column === 'purposes' ? JSON.stringify(record.purposes) : record[column],
    ),
  );
}

/**
 * CSV body that pulls one batch at a time, so a large site never sits in memory. `first` is the
 * batch the route already fetched (to turn a database failure into a clean 503 before any byte
 * is sent). An error after that point aborts the stream.
 */
export function consentCsvStream(
  batches: AsyncGenerator<ConsentRecord[]>,
  first: IteratorResult<ConsentRecord[]>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let pending: IteratorResult<ConsentRecord[]> | undefined = first;
  let headerSent = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const step = pending ?? (await batches.next());
        pending = undefined;
        const header = headerSent ? '' : CSV_HEADER;
        headerSent = true;
        const rows = step.done === true ? '' : step.value.map(consentCsvRow).join('');
        if (header !== '' || rows !== '') controller.enqueue(encoder.encode(header + rows));
        if (step.done === true) controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await batches.return(undefined);
    },
  });
}

/* Statistics */

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
  // Only receipts (`choice`) say what was denied, so older rows are left out of the rates.
  const categories = sql`case when jsonb_typeof(${consent.choice}::jsonb -> 'categories') = 'object' then ${consent.choice}::jsonb -> 'categories' end`;

  const [totals, volume, purposes, jurisdictions] = await Promise.all([
    db
      .select({
        consents: count,
        subjects: sql<number>`count(distinct ${consent.subjectId})`.mapWith(Number),
      })
      .from(consent)
      .where(where),
    db.select({ date: day, consents: count }).from(consent).where(where).groupBy(day).orderBy(day),
    db
      .select({
        purpose: sql<string>`cat.key`,
        granted: sql<number>`count(*) filter (where cat.value ->> 'value' = 'true')`.mapWith(
          Number,
        ),
        denied: sql<number>`count(*) filter (where cat.value ->> 'value' = 'false')`.mapWith(
          Number,
        ),
      })
      .from(sql`${consent}, jsonb_each(${categories}) as cat`)
      .where(where)
      .groupBy(sql`cat.key`)
      .orderBy(sql`cat.key`),
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
    purposes: purposes.map((row) => {
      const answered = row.granted + row.denied;
      return { ...row, optInRate: answered === 0 ? 0 : row.granted / answered };
    }),
    jurisdictions,
  };
}
