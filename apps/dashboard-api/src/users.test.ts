// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { expect, test } from 'vitest';
import { isBanActive } from './users.js';

const now = new Date('2026-03-01T12:00:00Z');

test('a ban is active without an expiry or with a future one', () => {
  expect(isBanActive({ banned: true, banExpires: null }, now)).toBe(true);
  expect(isBanActive({ banned: true, banExpires: new Date('2026-03-02T00:00:00Z') }, now)).toBe(
    true,
  );
});

test('a lifted or expired ban is not active', () => {
  expect(isBanActive({ banned: false, banExpires: null }, now)).toBe(false);
  expect(isBanActive({ banned: true, banExpires: new Date('2026-03-01T11:59:59Z') }, now)).toBe(
    false,
  );
  expect(isBanActive({ banned: true, banExpires: now }, now)).toBe(false);
});
