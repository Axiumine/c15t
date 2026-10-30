// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import * as fc from 'fast-check';
import { expect, test } from 'vitest';
import { GENERATED_PASSWORD_LENGTH, generatePassword } from './password.js';

const RUNS = { numRuns: 300 };

test('a generated password has the requested length and only unambiguous characters', () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 256 }), (length) => {
      const password = generatePassword(length);
      expect(password).toHaveLength(length);
      expect(password).toMatch(/^[A-HJ-NP-Za-hj-km-np-z2-9]*$/);
    }),
    RUNS,
  );
});

test('the default length is the documented one', () => {
  expect(generatePassword()).toHaveLength(GENERATED_PASSWORD_LENGTH);
});

test('generated passwords do not repeat', () => {
  fc.assert(
    fc.property(fc.integer({ min: 12, max: 64 }), (length) => {
      const seen = new Set(Array.from({ length: 50 }, () => generatePassword(length)));
      expect(seen.size).toBe(50);
    }),
    { numRuns: 50 },
  );
});

test('every character of the alphabet turns up, so no position is stuck on a subset', () => {
  const counts = new Map<string, number>();
  for (let i = 0; i < 1000; i++) {
    for (const char of generatePassword(20)) counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  expect(counts.size).toBe(55);
  // 20 000 draws over 55 characters is 364 each; a fair draw stays far from 200 and 560.
  for (const count of counts.values()) {
    expect(count).toBeGreaterThan(200);
    expect(count).toBeLessThan(560);
  }
});
