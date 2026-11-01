// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, test } from 'vitest';
import type { EnvironmentKind } from './testing/environment.js';
import { ENVIRONMENT_KINDS } from './testing/suite.js';
import { TZ_FIXTURES } from './testing/tz-fixtures.js';

/*
 * The read layer must give the same answer whatever TZ the process runs under (c15t stores naive
 * UTC timestamps). The probe runs seed, queries and HTTP routes in a child process per zone; the
 * outputs must be identical to the UTC run, and the UTC run must match values worked out here
 * from the fixture text alone. The machine zone, a zone with a half-hour offset, a zone west of
 * UTC and the two extreme offsets are covered.
 */

const run = promisify(execFile);
const packageRoot = fileURLToPath(new URL('..', import.meta.url));

const ZONES = [
  { zone: 'UTC', julyOffset: 0 },
  { zone: 'Europe/Rome', julyOffset: -120 },
  { zone: 'Asia/Kolkata', julyOffset: -330 },
  { zone: 'America/Los_Angeles', julyOffset: 420 },
  { zone: 'Pacific/Kiritimati', julyOffset: -840 },
  { zone: 'Pacific/Pago_Pago', julyOffset: 660 },
] as const;

interface ProbeOutput {
  julyOffsetMinutes: number;
  result: {
    direct: {
      allPages: { pages: number; items: { givenAt: string; subjectId: string }[] };
      halfOpen: { givenAt: string }[];
      stats: {
        totals: { consents: number; subjects: number };
        volume: { date: string; consents: number }[];
        range: { from: string; to: string };
      };
      csv: string;
    };
    http: {
      me: number;
      list: { status: number; body: string };
      stats: { status: number; body: string };
      csv: { status: number; body: string };
    };
  };
}

async function probe(kind: EnvironmentKind, zone: string): Promise<ProbeOutput> {
  try {
    const { stdout } = await run(
      process.execPath,
      ['--import', 'tsx', '--conditions=source', 'src/testing/tz-probe.ts', kind],
      { cwd: packageRoot, env: { ...process.env, TZ: zone }, timeout: 150_000 },
    );
    return JSON.parse(stdout.trim().split('\n').at(-1) ?? '') as ProbeOutput;
  } catch (error) {
    const failure = error as { stderr?: string; message: string };
    throw new Error(`probe ${kind} under TZ=${zone} failed: ${failure.stderr ?? failure.message}`, {
      cause: error,
    });
  }
}

const iso = (naive: string) => new Date(`${naive.replace(' ', 'T')}Z`).toISOString();
/** Fixtures per UTC day, read from the fixture text. April 1st is outside the March range. */
function consentsPerMarchDay(): Map<string, number> {
  const perDay = new Map<string, number>();
  for (const fixture of TZ_FIXTURES) {
    const day = fixture.givenAt.slice(0, 10);
    if (day < '2026-04-01') perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  return perDay;
}
const newestFirst = [...TZ_FIXTURES].sort((a, b) => b.givenAt.localeCompare(a.givenAt));

describe.each(ENVIRONMENT_KINDS)('the read layer is TZ-independent (%s)', (kind) => {
  const outputs = new Map<string, ProbeOutput | Error>();

  beforeAll(async () => {
    const one = async (zone: string) => {
      try {
        outputs.set(zone, await probe(kind, zone));
      } catch (error) {
        outputs.set(zone, error instanceof Error ? error : new Error(String(error)));
      }
    };
    // Parallel processes are fine for PGlite; the shared database gets one probe at a time.
    if (kind === 'pglite') await Promise.all(ZONES.map(({ zone }) => one(zone)));
    else for (const { zone } of ZONES) await one(zone);
  }, 600_000);

  const outputOf = (zone: string) => {
    const output = outputs.get(zone);
    if (output === undefined) throw new Error(`no probe output for ${zone}`);
    if (output instanceof Error) throw output;
    return output;
  };

  test('the UTC run matches the values worked out from the fixture text', () => {
    const { direct, http } = outputOf('UTC').result;
    expect(direct.allPages.pages).toBe(3);
    expect(direct.allPages.items.map((item) => item.givenAt)).toEqual(
      newestFirst.map((fixture) => iso(fixture.givenAt)),
    );
    expect(direct.halfOpen.map((item) => item.givenAt)).toEqual([iso('2026-03-08 02:30:00')]);
    // March only: the April 1st consent is outside the half-open range.
    expect(direct.stats.totals).toEqual({ consents: 9, subjects: 9 });
    expect(direct.stats.range).toEqual({
      from: '2026-03-01T00:00:00.000Z',
      to: '2026-04-01T00:00:00.000Z',
    });
    const perDay = consentsPerMarchDay();
    expect(direct.stats.volume).toHaveLength(31);
    for (const row of direct.stats.volume) {
      expect(row.consents, row.date).toBe(perDay.get(row.date) ?? 0);
    }
    expect(direct.csv.trim().split('\r\n')).toHaveLength(TZ_FIXTURES.length + 1);
    expect(http.me).toBe(200);
    expect(http.list.status).toBe(200);
    expect(http.stats.status).toBe(200);
    expect(http.csv.status).toBe(200);
    // 2026-03-29: three consents, around the hour that does not exist in Europe/Rome.
    expect(http.csv.body.trim().split('\r\n')).toHaveLength(4);
  });

  // The offset, not the zone name: ICU may report an alias such as Asia/Calcutta for Asia/Kolkata.
  test.each(ZONES)('the probe really runs under TZ=$zone', ({ julyOffset, zone }) => {
    expect(outputOf(zone).julyOffsetMinutes).toBe(julyOffset);
  });

  test.each(ZONES.filter(({ zone }) => zone !== 'UTC'))(
    'TZ=$zone returns exactly what UTC returns',
    ({ zone }) => {
      expect(outputOf(zone).result).toEqual(outputOf('UTC').result);
    },
  );
});
