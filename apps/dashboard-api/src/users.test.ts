// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { expect, test } from 'vitest';
import type { Executor } from './db.js';
import { countOtherActiveAdmins, isBanActive } from './users.js';

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

/** An executor whose `select().from().where()` resolves to `rows`. */
function executorAnswering(rows: readonly unknown[]): Executor {
  const chain = { from: () => chain, where: async () => rows };
  return { select: () => chain } as unknown as Executor;
}

test('the number of other active admins is the count the database returns', async () => {
  expect(await countOtherActiveAdmins(executorAnswering([{ n: 2 }]), 'u1', now)).toBe(2);
  expect(await countOtherActiveAdmins(executorAnswering([{ n: 0 }]), 'u1', now)).toBe(0);
});

test('a missing count row means no other active admin, so the last admin stays protected', async () => {
  expect(await countOtherActiveAdmins(executorAnswering([]), 'u1', now)).toBe(0);
});
