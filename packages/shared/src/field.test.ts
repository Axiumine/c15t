// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { expect, test } from 'vitest';
import { fieldOf } from './field.js';

test('reads a property of an object, whatever its type', () => {
  expect(fieldOf({ code: 'X' }, 'code')).toBe('X');
  expect(fieldOf({ n: 1 }, 'n')).toBe(1);
  expect(fieldOf(new Error('boom', { cause: 'why' }), 'cause')).toBe('why');
  expect(fieldOf([1, 2], 'length')).toBe(2);
});

test('is undefined for a missing property', () => {
  expect(fieldOf({}, 'code')).toBeUndefined();
});

test('is undefined for anything that is not an object', () => {
  for (const value of [null, undefined, 'text', 42, true, Symbol('s')]) {
    expect(fieldOf(value, 'length')).toBeUndefined();
  }
});
