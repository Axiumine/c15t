// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { expect, test } from 'vitest';
import { csvCell, csvRow } from './csv.js';

test('plain values stay as they are', () => {
  expect(csvCell('hello')).toBe('hello');
  expect(csvCell(42)).toBe('42');
  expect(csvCell(true)).toBe('true');
});

test('null and undefined are empty cells', () => {
  expect(csvCell(null)).toBe('');
  expect(csvCell(undefined)).toBe('');
});

test('quotes cells that contain commas, quotes or line breaks', () => {
  expect(csvCell('a,b')).toBe('"a,b"');
  expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
});

test.each(['=SUM(A1:A9)', '+1', '-1', '@cmd', '\tcmd', '\rcmd'])(
  'neutralizes the spreadsheet formula %j',
  (value) => {
    expect(csvCell(value).replace(/^"/, '').startsWith("'")).toBe(true);
  },
);

test('a formula with a comma is both neutralized and quoted', () => {
  expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
});

test('rows end with CRLF', () => {
  expect(csvRow(['a', null, 'c'])).toBe('a,,c\r\n');
});
