// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { expect, test } from 'vitest';
import { z } from 'zod';
import { HttpError } from './errors.js';
import { decodeCursor, encodeCursor, toPage } from './pagination.js';

const schema = z.object({ g: z.string(), i: z.string() });

test('a cursor round-trips', () => {
  const cursor = encodeCursor({ g: '2026-03-01 12:00:00', i: 'abc' });
  expect(decodeCursor(cursor, schema)).toEqual({ g: '2026-03-01 12:00:00', i: 'abc' });
});

test('no cursor means the first page', () => {
  expect(decodeCursor(undefined, schema)).toBeUndefined();
});

test.each([
  ['not base64 json', '%%%'],
  ['valid json of the wrong shape', Buffer.from('{"g":1}').toString('base64url')],
  ['json that is not an object', Buffer.from('[]').toString('base64url')],
])('rejects a forged cursor (%s) with a 400', (_name, cursor) => {
  const attempt = () => decodeCursor(cursor, schema);
  expect(attempt).toThrow(HttpError);
  expect(attempt).toThrow(expect.objectContaining({ code: 'BAD_REQUEST', status: 400 }));
});

test('toPage sets nextCursor from the last returned row when another page exists', () => {
  const rows = [1, 2, 3, 4];
  const page = toPage(
    rows,
    3,
    (n) => `item${n}`,
    (n) => `cursor${n}`,
  );
  expect(page).toEqual({ items: ['item1', 'item2', 'item3'], nextCursor: 'cursor3' });
});

test('toPage has no cursor on the last page', () => {
  expect(toPage([1, 2], 3, String, String)).toEqual({ items: ['1', '2'], nextCursor: null });
  expect(toPage([1, 2, 3], 3, String, String).nextCursor).toBeNull();
  expect(toPage([], 3, String, String)).toEqual({ items: [], nextCursor: null });
});
