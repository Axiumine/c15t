// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { tenantScope } from '../authz.js';
import {
  CSV_HEADER,
  consentBatches,
  consentCsvRow,
  consentStats,
  listConsents,
} from '../c15t-read.js';
import { createEnvironment, type EnvironmentKind } from './environment.js';
import { createTestApp } from './harness.js';
import { TZ_FIXTURES } from './tz-fixtures.js';

/*
 * Runs the whole read layer once, in THIS process, and prints the result as JSON. The test in
 * timezone.test.ts starts it with different TZ values and compares the outputs: a code path that
 * reads a naive c15t timestamp in the process time zone shows up as a difference.
 * Usage: node --import tsx --conditions=source src/testing/tz-probe.ts <pglite|postgres>
 */

const kind = process.argv[2];
if (kind !== 'pglite' && kind !== 'postgres') {
  throw new Error('Usage: tz-probe.ts <pglite|postgres>');
}

async function collectPages(
  run: (cursor: string | undefined) => Promise<{ items: unknown[]; nextCursor: string | null }>,
) {
  const items: unknown[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await run(cursor);
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
    pages++;
  } while (cursor !== undefined && pages < 20);
  return { pages, items };
}

async function probe(environmentKind: EnvironmentKind) {
  const env = await createEnvironment(environmentKind);
  const t = createTestApp(env);
  try {
    const admin = await t.createUser({ role: 'admin', label: 'tz-admin' });
    const site = await t.createSite({ label: 'tz' });
    await env.seedConsents(
      TZ_FIXTURES.map((fixture) => ({
        tenantId: site.key,
        subjectId: `${env.prefix}-sub-${fixture.name}`,
        domain: 'tz.example.test',
        givenAt: fixture.givenAt,
        choice: fixture.choice,
        jurisdiction: fixture.jurisdiction,
      })),
    );

    const db = env.pools.analytics;
    const scope = tenantScope([site.key]);
    const march = { from: new Date('2026-03-01T00:00:00Z'), to: new Date('2026-04-01T00:00:00Z') };

    const direct = {
      allPages: await collectPages((cursor) => listConsents(db, scope, {}, { cursor, limit: 4 })),
      // `to` is exclusive: the 09:59:59 consent stays out, the 02:30:00 one is in.
      halfOpen: (
        await listConsents(
          db,
          scope,
          { from: new Date('2026-03-08T00:00:00Z'), to: new Date('2026-03-08T09:59:59Z') },
          { limit: 50 },
        )
      ).items,
      stats: await consentStats(db, scope, march),
      csv: await (async () => {
        let text = CSV_HEADER;
        for await (const batch of consentBatches(db, scope, {}, 3)) {
          text += batch.map(consentCsvRow).join('');
        }
        return text;
      })(),
    };

    const cookie = await t.signIn(admin);
    const get = async (path: string) => {
      const response = await t.request('GET', path, { cookie });
      return { status: response.status, body: await response.text() };
    };
    const base = `/api/sites/${site.key}`;
    const http = {
      me: (await get('/api/me')).status,
      list: await get(`${base}/consents?limit=100&from=2026-03-08&to=2026-03-08`),
      stats: await get(`${base}/stats?from=2026-03-01&to=2026-03-31`),
      csv: await get(`${base}/consents.csv?from=2026-03-29&to=2026-03-29`),
    };

    // The run prefix is random, so it is replaced before the outputs are compared.
    const text = JSON.stringify({ direct, http }).split(env.prefix).join('P');
    process.stdout.write(
      `${JSON.stringify({
        julyOffsetMinutes: new Date(2026, 6, 1, 12).getTimezoneOffset(),
        result: JSON.parse(text) as unknown,
      })}\n`,
    );
  } finally {
    try {
      await env.cleanup();
    } finally {
      await t.close();
      await env.close();
    }
  }
}

await probe(kind);
