// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { describe, expect, test } from 'vitest';
import {
  consentExportQuerySchema,
  consentListQuerySchema,
  statsQuerySchema,
} from './consent-query.js';
import { CONSENT_CSV_COLUMNS, consentPageSchema, consentRecordSchema } from './consents.js';
import { statsResponseSchema } from './stats.js';

const record = {
  id: 'c1',
  subjectId: 'sub_1',
  externalId: null,
  domain: 'shop.example.com',
  givenAt: '2026-10-30T12:00:00.000Z',
  validUntil: null,
  purposes: { measurement: true, marketing: false },
  consentAction: 'custom',
  jurisdiction: 'GDPR',
  jurisdictionModel: 'opt-in',
  countryCode: 'DE',
  regionCode: null,
  uiSource: 'banner',
  ipAddress: '203.0.113.0',
  userAgent: 'Mozilla/5.0',
};

describe('query schemas', () => {
  test('stats accepts dates and timestamps and enforces order', () => {
    expect(statsQuerySchema.safeParse({}).success).toBe(true);
    expect(statsQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-30' }).success).toBe(true);
    expect(
      statsQuerySchema.safeParse({ from: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' })
        .success,
    ).toBe(true);
    expect(statsQuerySchema.safeParse({ from: '2026-10-30', to: '2026-10-01' }).success).toBe(
      false,
    );
    expect(statsQuerySchema.safeParse({ from: 'yesterday' }).success).toBe(false);
  });

  test('list combines subject, range and paging', () => {
    const parsed = consentListQuerySchema.parse({
      subject: ' sub_1 ',
      from: '2026-10-01',
      limit: '10',
    });
    expect(parsed).toEqual({ subject: 'sub_1', from: '2026-10-01', limit: 10 });
    expect(consentListQuerySchema.safeParse({ subject: '' }).success).toBe(false);
    expect(consentListQuerySchema.safeParse({ from: '2026-10-30', to: '2026-10-01' }).success).toBe(
      false,
    );
  });

  test('export takes only the range', () => {
    expect(consentExportQuerySchema.safeParse({ from: '2026-10-01' }).success).toBe(true);
    expect(consentExportQuerySchema.safeParse({ to: 'nope' }).success).toBe(false);
  });
});

describe('row and response shapes', () => {
  test('a record and a page of records parse', () => {
    expect(consentRecordSchema.safeParse(record).success).toBe(true);
    expect(consentPageSchema.safeParse({ items: [record], nextCursor: null }).success).toBe(true);
    expect(consentRecordSchema.safeParse({ ...record, purposes: { a: 'yes' } }).success).toBe(
      false,
    );
  });

  test('CSV columns are all record keys', () => {
    const keys = Object.keys(record);
    for (const column of CONSENT_CSV_COLUMNS) expect(keys).toContain(column);
    expect(CONSENT_CSV_COLUMNS).toHaveLength(keys.length);
  });

  test('stats response validates rates and counts', () => {
    const stats = {
      range: { from: '2026-10-01T00:00:00Z', to: '2026-10-30T23:59:59Z' },
      totals: { consents: 10, subjects: 8 },
      volume: [{ date: '2026-10-01', consents: 2 }],
      purposes: [{ purpose: 'marketing', granted: 3, denied: 7, optInRate: 0.3 }],
      jurisdictions: [{ jurisdiction: 'GDPR', consents: 10 }],
    };
    expect(statsResponseSchema.safeParse(stats).success).toBe(true);
    expect(
      statsResponseSchema.safeParse({
        ...stats,
        purposes: [{ purpose: 'marketing', granted: 3, denied: 7, optInRate: 1.2 }],
      }).success,
    ).toBe(false);
  });
});

describe('range bounds are limited to what Postgres stores', () => {
  test.each([
    '0000-01-01',
    '0000-06-01T00:00:00Z',
    // Year 0001 in a positive offset is year 0000 in UTC.
    '0001-01-01T00:00:00+05:00',
    // Year 9999 in a negative offset is year 10000 in UTC.
    '9999-12-31T23:59:59-05:00',
    '2026-02-30',
  ])('%s is rejected', (value) => {
    expect(statsQuerySchema.safeParse({ from: value }).success).toBe(false);
    expect(consentListQuerySchema.safeParse({ to: value }).success).toBe(false);
    expect(consentExportQuerySchema.safeParse({ from: value }).success).toBe(false);
  });

  test.each([
    '0001-01-01',
    '0001-01-01T00:00:00Z',
    '9999-12-31',
    '9999-12-31T23:59:59.999Z',
    '2026-02-28',
  ])('%s is accepted', (value) => {
    expect(statsQuerySchema.safeParse({ from: value }).success).toBe(true);
  });

  test('the subject filter rejects NUL', () => {
    expect(consentListQuerySchema.safeParse({ subject: 'a\u0000b' }).success).toBe(false);
    expect(consentListQuerySchema.safeParse({ subject: 'a b' }).success).toBe(true);
  });
});
