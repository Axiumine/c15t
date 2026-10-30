// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { PASSWORD_MIN_LENGTH } from '@consent/shared';
import { expect, test } from 'vitest';
import { GENERATED_PASSWORD_LENGTH, generatePassword } from './password.js';

test('meets the platform password rules and avoids look-alike characters', () => {
  const password = generatePassword();
  expect(password).toHaveLength(GENERATED_PASSWORD_LENGTH);
  expect(GENERATED_PASSWORD_LENGTH).toBeGreaterThanOrEqual(PASSWORD_MIN_LENGTH);
  expect(password).toMatch(/^[a-km-zA-HJ-NP-Z2-9]+$/);
});

test('is different every time', () => {
  const passwords = new Set(Array.from({ length: 200 }, () => generatePassword()));
  expect(passwords.size).toBe(200);
});
