// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import * as fc from 'fast-check';
import { expect, test } from 'vitest';
import { type CsvValue, csvCell, csvRow } from './csv.js';
import { parseCsv } from './testing/csv-reader.js';

/*
 * Property-based tests for the consent export. Cells carry visitor-controlled text, so two
 * promises matter: the file keeps its shape whatever a cell holds (RFC 4180), and no cell is
 * read as a formula by a spreadsheet (CSV injection).
 */

const RUNS = { numRuns: 300 };

const FORMULA_CHARS = ['=', '+', '-', '@', '\t', '\r'];
const nastyText = fc.string({ unit: fc.constantFrom(...'ab ,"\r\n\t=+-@\';|%0'), maxLength: 24 });
const text = fc.oneof(nastyText, fc.string(), fc.string({ unit: 'binary' }));
const cell: fc.Arbitrary<CsvValue> = fc.oneof(
  text,
  fc.integer(),
  fc.double({ noNaN: true }),
  fc.boolean(),
  fc.constantFrom(null, undefined),
);

/** What a cell reads back as: formulas gain one leading apostrophe, nothing else changes. */
function expected(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  return FORMULA_CHARS.some((char) => raw.startsWith(char)) ? `'${raw}` : raw;
}

test('a row reads back as exactly one record with the same cells', () => {
  fc.assert(
    fc.property(fc.array(cell, { minLength: 1, maxLength: 8 }), (values) => {
      const records = parseCsv(csvRow(values));
      expect(records).toEqual([values.map(expected)]);
    }),
    RUNS,
  );
});

test('rows concatenate into one record each, so no cell can start a new record', () => {
  fc.assert(
    fc.property(
      fc.array(fc.array(cell, { minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 6 }),
      (rows) => {
        const records = parseCsv(rows.map(csvRow).join(''));
        expect(records).toEqual(rows.map((row) => row.map(expected)));
      },
    ),
    RUNS,
  );
});

test('a cell that read back never starts with a character a spreadsheet runs as a formula', () => {
  fc.assert(
    fc.property(cell, (value) => {
      const field = parseCsv(csvRow([value, 'x']))[0]?.[0] ?? '';
      expect(FORMULA_CHARS.some((char) => field.startsWith(char))).toBe(false);
    }),
    RUNS,
  );
});

test('a cell without a formula character is lossless, and one with it is the original plus one apostrophe', () => {
  fc.assert(
    fc.property(text, (value) => {
      const field = parseCsv(csvRow([value, 'x']))[0]?.[0] ?? '';
      if (FORMULA_CHARS.some((char) => value.startsWith(char))) expect(field).toBe(`'${value}`);
      else expect(field).toBe(value);
    }),
    RUNS,
  );
});

test('the escaped cell is quoted exactly when the CSV syntax needs it', () => {
  fc.assert(
    fc.property(text, (value) => {
      const escaped = csvCell(value);
      const needsQuotes = /[",\r\n]/.test(expected(value));
      expect(escaped.startsWith('"')).toBe(needsQuotes);
      expect(escaped.endsWith('"')).toBe(needsQuotes);
      // A bare cell can never contain a delimiter or a line break.
      if (!needsQuotes) expect(escaped).not.toMatch(/[",\r\n]/);
    }),
    RUNS,
  );
});

test('a row has one terminator, at the end, and one comma fewer than it has cells', () => {
  fc.assert(
    fc.property(fc.array(cell, { minLength: 1, maxLength: 8 }), (values) => {
      const row = csvRow(values);
      expect(row.endsWith('\r\n')).toBe(true);
      const unquoted = row.replace(/"(?:[^"]|"")*"/g, '""');
      expect(unquoted.slice(0, -2)).not.toMatch(/[\r\n]/);
      expect(unquoted.split(',')).toHaveLength(values.length);
    }),
    RUNS,
  );
});

test('every formula prefix is neutralised in front of any payload', () => {
  fc.assert(
    fc.property(fc.constantFrom(...FORMULA_CHARS), text, (prefix, payload) => {
      const field = parseCsv(csvRow([`${prefix}${payload}`]))[0]?.[0];
      expect(field?.startsWith(`'${prefix}`)).toBe(true);
    }),
    RUNS,
  );
});
