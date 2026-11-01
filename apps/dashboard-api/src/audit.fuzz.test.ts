// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { isIP } from 'node:net';
import * as fc from 'fast-check';
import { expect, test } from 'vitest';
import { clientIp } from './audit-actor.js';

const RUNS = { numRuns: 300 };

test('the audited address is the first entry of X-Forwarded-For, or null when that is not an address', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.oneof(
          fc.ipV4(),
          fc.ipV6(),
          fc.string().filter((s) => !s.includes(',')),
        ),
        {
          minLength: 1,
          maxLength: 5,
        },
      ),
      (entries) => {
        const first = entries[0] ?? '';
        const found = clientIp(new Headers({ 'x-forwarded-for': entries.join(', ') }));
        if (found !== null) {
          expect(found).toBe(first.trim());
          expect(isIP(found)).not.toBe(0);
        }
        if (isIP(first) !== 0 && !first.includes('%')) expect(found).toBe(first);
      },
    ),
    RUNS,
  );
});

test('no header, or an empty one, gives no address', () => {
  expect(clientIp(new Headers())).toBeNull();
  expect(clientIp(new Headers({ 'x-forwarded-for': '' }))).toBeNull();
});
