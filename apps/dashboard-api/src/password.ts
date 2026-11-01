// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { randomInt } from 'node:crypto';

// No look-alike characters (0/O, 1/l/I): an admin reads this password out or types it from a screen.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const GENERATED_PASSWORD_LENGTH = 20;

/** About 114 bits of entropy from the platform CSPRNG. Shown once, never stored or logged. */
export function generatePassword(length = GENERATED_PASSWORD_LENGTH): string {
  let password = '';
  for (let i = 0; i < length; i++) password += ALPHABET.charAt(randomInt(ALPHABET.length));
  return password;
}
