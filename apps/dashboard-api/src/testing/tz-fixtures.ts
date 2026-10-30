// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

/**
 * Consents placed on the edges where a code path that reads naive timestamps in the process time
 * zone goes wrong: day boundaries, the half-open range edge, and the hours that do not exist (or
 * exist twice) on a DST change in Europe/Rome and America/Los_Angeles.
 * `givenAt` is naive UTC, as c15t stores it.
 */
export interface TzFixture {
  readonly name: string;
  readonly givenAt: string;
  readonly choice: Readonly<Record<string, boolean>>;
  readonly jurisdiction: string;
}

export const TZ_FIXTURES: readonly TzFixture[] = [
  {
    name: 'f01',
    givenAt: '2026-03-01 00:00:00',
    choice: { marketing: true },
    jurisdiction: 'GDPR',
  },
  {
    name: 'f02',
    givenAt: '2026-03-01 23:59:59.500',
    choice: { marketing: false },
    jurisdiction: 'GDPR',
  },
  {
    name: 'f03',
    givenAt: '2026-03-08 02:30:00',
    choice: { marketing: true, measurement: false },
    jurisdiction: 'CCPA',
  },
  {
    name: 'f04',
    givenAt: '2026-03-08 09:59:59',
    choice: { measurement: true },
    jurisdiction: 'CCPA',
  },
  {
    name: 'f05',
    givenAt: '2026-03-15 18:45:00',
    choice: { marketing: false, measurement: true },
    jurisdiction: 'GDPR',
  },
  {
    name: 'f06',
    givenAt: '2026-03-29 01:30:00',
    choice: { marketing: true },
    jurisdiction: 'GDPR',
  },
  {
    name: 'f07',
    givenAt: '2026-03-29 02:30:00',
    choice: { marketing: false },
    jurisdiction: 'GDPR',
  },
  {
    name: 'f08',
    givenAt: '2026-03-29 03:30:00',
    choice: { measurement: false },
    jurisdiction: 'GDPR',
  },
  {
    name: 'f09',
    givenAt: '2026-03-31 22:30:00',
    choice: { marketing: true, measurement: true },
    jurisdiction: 'GDPR',
  },
  {
    name: 'f10',
    givenAt: '2026-04-01 00:00:00',
    choice: { marketing: true },
    jurisdiction: 'GDPR',
  },
];
