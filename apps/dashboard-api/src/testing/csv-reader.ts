// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { expect } from 'vitest';

/** One field (quoted or bare) followed by its delimiter: a comma or the CRLF that ends a record. */
const FIELD = /(?:"((?:[^"]|"")*)"|([^",\r\n]*))(,|\r\n)/y;

/** A strict RFC 4180 reader, written separately from the writer under test. */
export function parseCsv(input: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let position = 0;
  while (position < input.length) {
    FIELD.lastIndex = position;
    const match = FIELD.exec(input);
    expect(match, `malformed CSV at offset ${position}`).not.toBeNull();
    if (match === null) break;
    record.push((match[1] ?? match[2] ?? '').replaceAll('""', '"'));
    position = FIELD.lastIndex;
    if (match[3] === '\r\n') {
      records.push(record);
      record = [];
    }
  }
  expect(record).toEqual([]);
  return records;
}
