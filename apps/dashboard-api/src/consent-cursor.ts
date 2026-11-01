// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { isRepresentableInstant, noNul } from '@consent/shared';
import { z } from 'zod';

const NAIVE_SECONDS = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/;
const NAIVE_FRACTION = /^\.\d{1,6}$/;

/**
 * `YYYY-MM-DD[ T]HH:MM:SS[.ffffff]` that is a real UTC date: the shape check alone lets month 13,
 * 31 February or hour 24 through, and Postgres answers those with an error instead of a 400.
 */
export function isNaiveTimestamp(value: string): boolean {
  // The seconds part is fixed-width (19 characters). What follows it is empty or `.f` to `.ffffff`.
  const fraction = value.slice(19);
  if (!NAIVE_SECONDS.test(value.slice(0, 19))) return false;
  if (fraction !== '' && !NAIVE_FRACTION.test(fraction)) return false;
  const seconds = `${value.slice(0, 10)}T${value.slice(11, 19)}`;
  const ms = Date.parse(`${seconds}Z`);
  // Round trip: JavaScript rolls 31 February over to 3 March, so the text must come back as it went in.
  return isRepresentableInstant(ms) && new Date(ms).toISOString().slice(0, 19) === seconds;
}

const naiveTimestamp = z.string().refine(isNaiveTimestamp, 'Not a UTC timestamp');
export const consentCursorSchema = z.object({
  g: naiveTimestamp,
  i: noNul(z.string().min(1).max(255)),
});
export type ConsentCursor = z.output<typeof consentCursorSchema>;
