// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Database } from '@consent/db';
import { consentRecordSchema, statsResponseSchema } from '@consent/shared';
import { beforeAll, expect, test } from 'vitest';
import { tenantScope } from './authz.js';
import {
  consentBatches,
  consentCsvRow,
  consentCsvStream,
  consentStats,
  derivePurposes,
  isNaiveTimestamp,
  listConsents,
  toConsentRecord,
} from './c15t-read.js';
import { HttpError } from './errors.js';
import type { ConsentFixture } from './testing/environment.js';
import { describeEnvironments } from './testing/suite.js';

describeEnvironments('c15t-read', ({ env }) => {
  let tenantA = '';
  let tenantB = '';
  let db: ReturnType<typeof env>['pools']['analytics'];
  const sub = (name: string) => `${env().prefix}-sub-${name}`;

  beforeAll(async () => {
    const { prefix, pools } = env();
    db = pools.analytics;
    tenantA = `${prefix}-ta`;
    tenantB = `${prefix}-tb`;
    // Tenant B first: its subject row wins the shared id below, so A's consent joins a foreign subject.
    await env().seedConsents([
      {
        tenantId: tenantB,
        subjectId: sub('shared'),
        domain: 'b.example.test',
        givenAt: '2026-03-02 09:00:00',
      },
      {
        tenantId: tenantB,
        subjectId: sub('b1'),
        domain: 'b.example.test',
        givenAt: '2026-03-03 10:00:00',
        choice: { marketing: true },
      },
    ]);
    const a = (n: string, extra: Partial<ConsentFixture>): ConsentFixture => ({
      tenantId: tenantA,
      subjectId: sub(n),
      domain: 'a.example.test',
      givenAt: '2026-03-01 12:00:00',
      ...extra,
    });
    await env().seedConsents([
      a('a1', {
        externalId: `${prefix}-ext-1`,
        givenAt: '2026-03-01 12:00:00',
        choice: { measurement: true, marketing: false },
        jurisdiction: 'GDPR',
        countryCode: 'DE',
        userAgent: '=cmd|calc',
      }),
      a('a2', {
        givenAt: '2026-03-02 08:30:00',
        choice: { measurement: true, marketing: true },
        jurisdiction: 'GDPR',
        countryCode: 'FR',
      }),
      a('a3', {
        givenAt: '2026-03-02 08:30:00',
        choice: { measurement: false, marketing: false },
        jurisdiction: 'CCPA',
        countryCode: 'US',
        regionCode: 'CA',
      }),
      a('a4', { givenAt: '2026-03-02 08:30:00', legacyPurposes: ['measurement'] }),
      a('a5', { givenAt: '2026-03-05 23:59:59.500' }),
      // A consent of tenant A that points at the subject row owned by tenant B.
      a('shared', { subjectId: sub('shared'), givenAt: '2026-03-04 00:00:00' }),
    ]);
  }, 60_000);

  const first = { limit: 50 };
  const idsOf = (page: { items: { subjectId: string }[] }) =>
    page.items.map((item) => item.subjectId);
  const alphabetical = (a: string, b: string) => a.localeCompare(b);

  test('only returns rows of the tenants in the scope', async () => {
    const pageA = await listConsents(db, tenantScope([tenantA]), {}, first);
    const pageB = await listConsents(db, tenantScope([tenantB]), {}, first);
    expect(idsOf(pageA).sort(alphabetical)).toEqual(
      [sub('a1'), sub('a2'), sub('a3'), sub('a4'), sub('a5')].sort(alphabetical),
    );
    expect(idsOf(pageB).sort(alphabetical)).toEqual([sub('b1'), sub('shared')].sort(alphabetical));
    const both = await listConsents(db, tenantScope([tenantA, tenantB]), {}, first);
    expect(both.items).toHaveLength(pageA.items.length + pageB.items.length);
  });

  test('an empty scope or an unknown tenant returns nothing', async () => {
    expect((await listConsents(db, tenantScope([]), {}, first)).items).toEqual([]);
    expect(
      (await listConsents(db, tenantScope([`${env().prefix}-nobody`]), {}, first)).items,
    ).toEqual([]);
  });

  test('never exposes a subject that belongs to another tenant', async () => {
    const pageA = await listConsents(db, tenantScope([tenantA]), {}, first);
    expect(idsOf(pageA)).not.toContain(sub('shared'));
  });

  test('records match the shared schema', async () => {
    const page = await listConsents(db, tenantScope([tenantA]), { subject: sub('a1') }, first);
    const [record] = page.items;
    expect(consentRecordSchema.parse(record)).toMatchObject({
      subjectId: sub('a1'),
      externalId: `${env().prefix}-ext-1`,
      domain: 'a.example.test',
      givenAt: '2026-03-01T12:00:00.000Z',
      purposes: { measurement: true, marketing: false },
      jurisdiction: 'GDPR',
      countryCode: 'DE',
    });
  });

  test('searches by exact subject id or external id, not by fragment', async () => {
    const scope = tenantScope([tenantA]);
    expect(idsOf(await listConsents(db, scope, { subject: sub('a2') }, first))).toEqual([
      sub('a2'),
    ]);
    expect(
      idsOf(await listConsents(db, scope, { subject: `${env().prefix}-ext-1` }, first)),
    ).toEqual([sub('a1')]);
    expect((await listConsents(db, scope, { subject: sub('a') }, first)).items).toEqual([]);
    expect((await listConsents(db, scope, { subject: '%' }, first)).items).toEqual([]);
    // Another tenant's subject id is not found through this scope.
    expect((await listConsents(db, scope, { subject: sub('b1') }, first)).items).toEqual([]);
  });

  test('filters by half-open time range', async () => {
    const scope = tenantScope([tenantA]);
    const day = await listConsents(
      db,
      scope,
      { from: new Date('2026-03-02T00:00:00Z'), to: new Date('2026-03-03T00:00:00Z') },
      first,
    );
    expect(idsOf(day).sort(alphabetical)).toEqual(
      [sub('a2'), sub('a3'), sub('a4')].sort(alphabetical),
    );
    const upperEdge = await listConsents(
      db,
      scope,
      { to: new Date('2026-03-02T08:30:00Z') },
      first,
    );
    expect(idsOf(upperEdge)).toEqual([sub('a1')]);
  });

  test('paginates newest first without repeats or gaps, including rows with equal timestamps', async () => {
    const scope = tenantScope([tenantA]);
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await listConsents(db, scope, {}, { limit: 2, cursor });
      seen.push(...idsOf(page));
      cursor = page.nextCursor ?? undefined;
      pages++;
    } while (cursor !== undefined && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(seen[0]).toBe(sub('a5'));
    expect(seen.at(-1)).toBe(sub('a1'));
  });

  test('a cursor cannot widen the scope', async () => {
    const pageA = await listConsents(db, tenantScope([tenantA]), {}, { limit: 1 });
    expect(pageA.nextCursor).not.toBeNull();
    const pageB = await listConsents(
      db,
      tenantScope([tenantB]),
      {},
      { limit: 50, cursor: pageA.nextCursor ?? '' },
    );
    for (const item of pageB.items) expect(item.subjectId).toMatch(/-sub-(b1|shared)$/);
  });

  test('rejects a forged cursor', async () => {
    await expect(
      listConsents(db, tenantScope([tenantA]), {}, { limit: 5, cursor: 'Zm9yZ2Vk' }),
    ).rejects.toBeInstanceOf(HttpError);
  });

  test('derives purposes from receipts and from legacy purpose ids', async () => {
    const page = await listConsents(db, tenantScope([tenantA]), { subject: sub('a4') }, first);
    expect(page.items[0]?.purposes).toEqual({ measurement: true });
    const none = await listConsents(db, tenantScope([tenantA]), { subject: sub('a5') }, first);
    expect(none.items[0]?.purposes).toEqual({});
  });

  test('stats count only the scoped tenant and fill empty days', async () => {
    const stats = await consentStats(db, tenantScope([tenantA]), {
      from: new Date('2026-03-01T00:00:00Z'),
      to: new Date('2026-03-07T00:00:00Z'),
    });
    expect(statsResponseSchema.parse(stats)).toEqual(stats);
    expect(stats.totals).toEqual({ consents: 6, subjects: 6 });
    expect(stats.volume).toEqual([
      { date: '2026-03-01', consents: 1 },
      { date: '2026-03-02', consents: 3 },
      { date: '2026-03-03', consents: 0 },
      { date: '2026-03-04', consents: 1 },
      { date: '2026-03-05', consents: 1 },
      { date: '2026-03-06', consents: 0 },
    ]);
    expect(stats.purposes).toEqual([
      { purpose: 'marketing', granted: 1, denied: 2, optInRate: 1 / 3 },
      { purpose: 'measurement', granted: 2, denied: 1, optInRate: 2 / 3 },
    ]);
    expect(stats.jurisdictions).toEqual([
      { jurisdiction: 'unknown', consents: 3 },
      { jurisdiction: 'GDPR', consents: 2 },
      { jurisdiction: 'CCPA', consents: 1 },
    ]);
  });

  test('a purpose that was neither granted nor denied has an opt-in rate of 0, not NaN', async () => {
    const tenant = `${env().prefix}-tc`;
    // A receipt whose category carries no boolean `value` (the cast writes `value: null`).
    await env().seedConsents([
      {
        tenantId: tenant,
        subjectId: sub('c1'),
        domain: 'c.example.test',
        givenAt: '2026-03-02 10:00:00',
        choice: { analytics: null as unknown as boolean, measurement: true },
      },
    ]);
    const stats = await consentStats(db, tenantScope([tenant]), {
      from: new Date('2026-03-01T00:00:00Z'),
      to: new Date('2026-03-03T00:00:00Z'),
    });
    expect(stats.totals).toEqual({ consents: 1, subjects: 1 });
    expect(stats.purposes).toEqual([
      { purpose: 'analytics', granted: 0, denied: 0, optInRate: 0 },
      { purpose: 'measurement', granted: 1, denied: 0, optInRate: 1 },
    ]);
    // The same rows are invisible to a scope that does not list this tenant.
    const foreign = await consentStats(db, tenantScope([tenantA]), {
      from: new Date('2026-03-02T09:00:00Z'),
      to: new Date('2026-03-02T11:00:00Z'),
    });
    expect(foreign.purposes.map((row) => row.purpose)).not.toContain('analytics');
  });

  test('stats respect the range and never see other tenants', async () => {
    const narrow = await consentStats(db, tenantScope([tenantA]), {
      from: new Date('2026-03-02T00:00:00Z'),
      to: new Date('2026-03-03T00:00:00Z'),
    });
    expect(narrow.totals.consents).toBe(3);
    const other = await consentStats(db, tenantScope([`${env().prefix}-nobody`]), {
      from: new Date('2026-03-01T00:00:00Z'),
      to: new Date('2026-03-07T00:00:00Z'),
    });
    expect(other.totals).toEqual({ consents: 0, subjects: 0 });
    expect(other.purposes).toEqual([]);
  });

  test('export batches never exceed the batch size and cover every row once', async () => {
    const sizes: number[] = [];
    const ids: string[] = [];
    for await (const batch of consentBatches(db, tenantScope([tenantA]), {}, 2)) {
      sizes.push(batch.length);
      ids.push(...batch.map((record) => record.subjectId));
    }
    expect(sizes).toEqual([2, 2, 1]);
    expect(new Set(ids).size).toBe(5);
  });

  test('export of an empty selection is only the CSV header', async () => {
    const batches = consentBatches(db, tenantScope([`${env().prefix}-nobody`]), {});
    const stream = consentCsvStream(batches, await batches.next());
    const text = await new Response(stream).text();
    expect(text.startsWith('id,subjectId,externalId,domain,givenAt')).toBe(true);
    expect(text.trim().split('\r\n')).toHaveLength(1);
  });

  test('csv rows neutralize formulas and serialize purposes as JSON', async () => {
    const page = await listConsents(db, tenantScope([tenantA]), { subject: sub('a1') }, first);
    const row = consentCsvRow(page.items[0] as NonNullable<(typeof page.items)[number]>);
    expect(row).toContain("'=cmd|calc");
    expect(row).toContain('"{""measurement"":true,""marketing"":false}"');
  });
});

test('derivePurposes copes with malformed data', () => {
  const codes = new Map([['p1', 'marketing']]);
  expect(derivePurposes(null, null, codes)).toEqual({});
  expect(derivePurposes('not json', 'also not json', codes)).toEqual({});
  expect(
    derivePurposes({ categories: { marketing: { value: 'yes' } } }, ['unknown'], codes),
  ).toEqual({});
  expect(
    derivePurposes(
      { json: { categories: { marketing: { value: false } } } },
      { json: ['p1'] },
      codes,
    ),
  ).toEqual({
    marketing: false,
  });
  expect(derivePurposes(null, JSON.stringify(['p1']), codes)).toEqual({ marketing: true });
});

test('isNaiveTimestamp accepts only real UTC timestamps in the stored shape', () => {
  expect(isNaiveTimestamp('2026-03-01 12:00:00')).toBe(true);
  expect(isNaiveTimestamp('2026-03-01T12:00:00.123456')).toBe(true);
  expect(isNaiveTimestamp('2026-03-01 12:00:00.1')).toBe(true);
  // Wrong shape: text, a zone suffix, a missing part, too many fraction digits.
  for (const value of [
    '',
    'forged',
    '2026-03-01',
    '2026-03-01T12:00:00Z',
    '2026-03-01 12:00',
    '2026-03-01 12:00:00.1234567',
    ' 2026-03-01 12:00:00',
    '2026-03-01 12:00:00.',
    '2026-03-01 12:00:00:1',
    '2026-03-01 12:00:00\n',
    '2026-03-01 12:00:00.1\n',
    '2026-03-01 12:00:001',
  ]) {
    expect(isNaiveTimestamp(value)).toBe(false);
  }
  // Right shape, impossible date: JavaScript would roll these over, Postgres would answer 22008.
  expect(isNaiveTimestamp('2026-02-31 00:00:00')).toBe(false);
  expect(isNaiveTimestamp('2026-13-01 00:00:00')).toBe(false);
  expect(isNaiveTimestamp('2026-03-01 24:00:00')).toBe(false);
});

test('toConsentRecord keeps an absent validUntil null and converts a present one to UTC ISO', () => {
  const row: Parameters<typeof toConsentRecord>[0] = {
    id: 'c1',
    subjectId: 's1',
    externalId: null,
    domain: 'a.example.test',
    givenAt: '2026-03-01 12:00:00',
    validUntil: null,
    purposeIds: null,
    choice: { categories: { marketing: { value: true } } },
    consentAction: 'all',
    jurisdiction: 'GDPR',
    jurisdictionModel: 'opt-in',
    countryCode: 'DE',
    regionCode: null,
    uiSource: 'banner',
    ipAddress: null,
    userAgent: null,
  };
  const none = toConsentRecord(row, new Map());
  expect(none.validUntil).toBeNull();
  expect(none.givenAt).toBe('2026-03-01T12:00:00.000Z');
  expect(none.purposes).toEqual({ marketing: true });
  const dated = toConsentRecord({ ...row, validUntil: '2027-03-01 12:00:00' }, new Map());
  expect(dated.validUntil).toBe('2027-03-01T12:00:00.000Z');
});

/** A `Database` whose n-th `select()` chain resolves to `results[n]`, whatever is chained on it. */
function databaseAnswering(results: readonly (readonly unknown[])[]): Database {
  let call = 0;
  const chain = (rows: readonly unknown[]): unknown =>
    new Proxy(() => undefined, {
      get: (_target, property) =>
        property === 'then'
          ? (resolve: (value: unknown) => void) => resolve(rows)
          : () => chain(rows),
    });
  return { select: () => chain(results[call++] ?? []) } as unknown as Database;
}

test('stats of a result set without a totals row are zero, not a crash', async () => {
  const stats = await consentStats(databaseAnswering([[], [], [], []]), tenantScope(['any']), {
    from: new Date('2026-03-01T00:00:00Z'),
    to: new Date('2026-03-03T00:00:00Z'),
  });
  expect(stats.totals).toEqual({ consents: 0, subjects: 0 });
  expect(stats.volume).toEqual([
    { date: '2026-03-01', consents: 0 },
    { date: '2026-03-02', consents: 0 },
  ]);
  expect(stats.purposes).toEqual([]);
  expect(stats.jurisdictions).toEqual([]);
  expect(statsResponseSchema.parse(stats)).toEqual(stats);
});
