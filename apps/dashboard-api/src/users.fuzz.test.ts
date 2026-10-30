// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import * as fc from 'fast-check';
import { expect, test } from 'vitest';
import { isBanActive } from './users.js';

const RUNS = { numRuns: 300 };
const instant = fc.date({
  min: new Date('2000-01-01T00:00:00.000Z'),
  max: new Date('2100-01-01T00:00:00.000Z'),
  noInvalidDate: true,
});

test('a user who is not banned is never reported as banned', () => {
  fc.assert(
    fc.property(fc.option(instant, { nil: null }), instant, (banExpires, now) => {
      expect(isBanActive({ banned: false, banExpires }, now)).toBe(false);
    }),
    RUNS,
  );
});

test('a ban without an expiry never lapses', () => {
  fc.assert(
    fc.property(instant, (now) => {
      expect(isBanActive({ banned: true, banExpires: null }, now)).toBe(true);
    }),
    RUNS,
  );
});

test('a ban with an expiry holds until that instant and not a millisecond longer', () => {
  fc.assert(
    fc.property(instant, fc.integer({ min: -86_400_000, max: 86_400_000 }), (expiry, delta) => {
      const now = new Date(expiry.getTime() + delta);
      expect(isBanActive({ banned: true, banExpires: expiry }, now)).toBe(delta < 0);
    }),
    RUNS,
  );
});
