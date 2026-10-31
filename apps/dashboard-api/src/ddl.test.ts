// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { c15t } from '@consent/db';
import { is, sql } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createPgliteEnvironment, type TestEnvironment } from './testing/environment.js';

/*
 * The PGlite tests run against hand-written c15t DDL. This keeps it honest: every column of
 * the generated Drizzle types (`yarn db:pull-c15t`) must exist, with the same name and nullability.
 */
let environment: TestEnvironment;

// PGlite boots a WASM Postgres and applies every migration. The default 10 s hook limit is not
// enough when the whole suite runs in parallel, so this uses the same budget as the other suites.
beforeAll(async () => {
  environment = await createPgliteEnvironment();
}, 120_000);
afterAll(async () => {
  await environment?.close();
});

function generatedTables(): PgTable[] {
  const tables: PgTable[] = [];
  for (const value of Object.values(c15t)) if (is(value, PgTable)) tables.push(value);
  return tables;
}
const generated = generatedTables();

test('the generated c15t types are found', () => {
  expect(generated.length).toBeGreaterThanOrEqual(7);
});

test('the test DDL matches every generated c15t table the queries use', async () => {
  const result = (await environment.pools.primary.execute(
    sql`select table_name, column_name, is_nullable from information_schema.columns where table_schema = 'c15t'`,
  )) as unknown as { rows: { table_name: string; column_name: string; is_nullable: string }[] };
  const actual = new Map<string, Map<string, boolean>>();
  for (const row of result.rows) {
    const columns = actual.get(row.table_name) ?? new Map<string, boolean>();
    columns.set(row.column_name, row.is_nullable === 'NO');
    actual.set(row.table_name, columns);
  }
  const used = [
    'subject',
    'domain',
    'consentPurpose',
    'runtimePolicyDecision',
    'consent',
    'consentPolicy',
  ];
  for (const table of generated) {
    const config = getTableConfig(table);
    if (!used.includes(config.name)) continue;
    const columns = actual.get(config.name);
    expect(columns, `table ${config.name}`).toBeDefined();
    for (const column of config.columns) {
      expect(columns?.has(column.name), `${config.name}.${column.name} exists`).toBe(true);
      expect(columns?.get(column.name), `${config.name}.${column.name} is not null`).toBe(
        column.notNull,
      );
    }
  }
});
