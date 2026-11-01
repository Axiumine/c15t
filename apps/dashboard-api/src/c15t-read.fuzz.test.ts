// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { CONSENT_CSV_COLUMNS, type ConsentRecord } from '@consent/shared';
import * as fc from 'fast-check';
import { expect, test } from 'vitest';
import { consentCsvRow } from './c15t-read.js';
import { derivePurposes } from './consent-purposes.js';
import { parseCsv } from './testing/csv-reader.js';

/*
 * Property-based tests for the two places where visitor-controlled data from the `c15t` schema
 * is turned into something an admin sees: the purposes JSON and the CSV export.
 */

const RUNS = { numRuns: 300 };
const FORMULA_CHARS = ['=', '+', '-', '@', '\t', '\r'];

/** Strings a hostile visitor might store in a user agent or an external id. */
const hostileText = fc.oneof(
  fc.string(),
  fc.string({ unit: 'binary' }),
  fc.string({ unit: fc.constantFrom(...Array.from('ab ,"\r\n\t=+-@\'|;')) }),
  fc.constantFrom("=cmd|' /C calc'!A0", '@SUM(1+1)', '+1+1', '-2+3', '\t=1+1', 'a,b', '"quoted"'),
);
const nullable = fc.option(hostileText, { nil: null });

const record: fc.Arbitrary<ConsentRecord> = fc.record({
  id: hostileText,
  subjectId: hostileText,
  externalId: nullable,
  domain: nullable,
  givenAt: fc.date({ noInvalidDate: true }).map((date) => date.toISOString()),
  validUntil: fc.option(
    fc.date({ noInvalidDate: true }).map((date) => date.toISOString()),
    { nil: null },
  ),
  purposes: fc.dictionary(
    fc.string().filter((key) => key !== '__proto__'),
    fc.boolean(),
  ),
  consentAction: nullable,
  jurisdiction: nullable,
  jurisdictionModel: nullable,
  countryCode: nullable,
  regionCode: nullable,
  uiSource: nullable,
  ipAddress: nullable,
  userAgent: nullable,
});

test('a consent row exports as exactly one CSV record with one cell per column', () => {
  fc.assert(
    fc.property(record, (consent) => {
      const records = parseCsv(consentCsvRow(consent));
      expect(records).toHaveLength(1);
      expect(records[0]).toHaveLength(CONSENT_CSV_COLUMNS.length);
    }),
    RUNS,
  );
});

test('no exported cell starts with a character a spreadsheet runs as a formula', () => {
  fc.assert(
    fc.property(record, (consent) => {
      for (const cell of parseCsv(consentCsvRow(consent))[0] ?? []) {
        expect(FORMULA_CHARS.some((char) => cell.startsWith(char))).toBe(false);
      }
    }),
    RUNS,
  );
});

test('the purposes column is JSON that reads back as the same purposes', () => {
  fc.assert(
    fc.property(record, (consent) => {
      const cells = parseCsv(consentCsvRow(consent))[0] ?? [];
      const purposes = cells[CONSENT_CSV_COLUMNS.indexOf('purposes')] ?? '';
      expect(JSON.parse(purposes)).toEqual(consent.purposes);
    }),
    RUNS,
  );
});

test('free-text cells keep the visitor text, bar the one apostrophe that disarms a formula', () => {
  fc.assert(
    fc.property(record, (consent) => {
      const cells = parseCsv(consentCsvRow(consent))[0] ?? [];
      const freeText = [
        ['externalId', consent.externalId],
        ['domain', consent.domain],
        ['userAgent', consent.userAgent],
        ['ipAddress', consent.ipAddress],
      ] as const;
      for (const [column, value] of freeText) {
        const original = value ?? '';
        const cell = cells[CONSENT_CSV_COLUMNS.indexOf(column)] ?? '';
        const armed = FORMULA_CHARS.some((char) => original.startsWith(char));
        expect(cell).toBe(armed ? `'${original}` : original);
      }
    }),
    RUNS,
  );
});

/** JSON values of every shape, including the `{ json: ... }` wrapper of c15t 2.x. */
const jsonish = fc.oneof(
  fc.anything(),
  fc.jsonValue(),
  fc.jsonValue().map((value) => ({ json: value })),
  fc.jsonValue().map((value) => JSON.stringify(value)),
  fc.record({
    categories: fc.dictionary(
      fc.string().filter((key) => key !== '__proto__'),
      fc.oneof(fc.record({ value: fc.boolean() }), fc.anything()),
    ),
  }),
);

test('purposes derived from any stored choice are a flat map of booleans, and never throw', () => {
  const codes = new Map([
    ['p1', 'measurement'],
    ['p2', 'marketing'],
  ]);
  fc.assert(
    fc.property(jsonish, jsonish, (choice, purposeIds) => {
      const purposes = derivePurposes(choice, purposeIds, codes);
      for (const [code, granted] of Object.entries(purposes)) {
        expect(typeof code).toBe('string');
        expect(typeof granted).toBe('boolean');
      }
    }),
    RUNS,
  );
});

test('a receipt that says `false` is never turned into a grant by the legacy purpose list', () => {
  const codes = new Map([['p1', 'marketing']]);
  fc.assert(
    fc.property(fc.boolean(), (granted) => {
      const choice = { categories: { marketing: { value: granted } } };
      expect(derivePurposes(choice, ['p1'], codes)).toEqual({ marketing: granted });
      expect(derivePurposes({ json: JSON.stringify(choice) }, ['p1'], codes)).toEqual({
        marketing: granted,
      });
    }),
    RUNS,
  );
});

/*
 * Known gap: `unwrapJson` follows `{ json: ... }` wrappers by plain recursion, so a stored value
 * nested about 20 000 levels deep ends in `RangeError: Maximum call stack size exceeded`, and
 * that one row would turn the consents list and the CSV export of its site into a 500. c15t
 * builds `choice` itself, so no visitor path to such a row is known; it is a robustness gap, not
 * a proven exploit. Kept as `fails` until the unwrapping is iterative or depth-limited.
 */
test.fails('a deeply nested stored choice does not overflow the stack', () => {
  let choice: unknown = { categories: { marketing: { value: true } } };
  for (let depth = 0; depth < 50_000; depth++) choice = { json: choice };
  expect(() => derivePurposes(choice, [], new Map())).not.toThrow();
});
