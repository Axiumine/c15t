// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { expect, test } from 'vitest';
import { clientIp } from './audit-actor.js';

test('the audit address is the first X-Forwarded-For entry, trimmed, when it is an IP address', () => {
  const header = (value: string) => new Headers({ 'x-forwarded-for': value });
  expect(clientIp(header(' 198.51.100.7 , 10.0.0.1'))).toBe('198.51.100.7');
  expect(clientIp(header('2001:db8::7,10.0.0.1'))).toBe('2001:db8::7');
  // Only the first entry counts, and a first entry that is not an address records nothing.
  expect(clientIp(header('unknown, 198.51.100.7'))).toBeNull();
  expect(clientIp(header('198.51.100.7:8080'))).toBeNull();
});
