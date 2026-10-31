// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { applyMigrations, postgresExecutor } from './migrator.js';

/*
 * postgresExecutor adapts a postgres.js pool to SqlExecutor. The first block uses a recording
 * fake to pin down the pool/transaction rules; the second drives the real migration files
 * through the adapter, with PGlite answering as the server.
 */
type Row = Record<string, unknown>;

function fakeSql(rows: Row[] = []) {
  const unsafe = vi.fn(async (_text: string, _params?: unknown[]) => rows);
  const tx = { unsafe };
  const begin = vi.fn(async (run: (inner: { unsafe: typeof unsafe }) => Promise<unknown>) =>
    run(tx),
  );
  return { sql: { unsafe, begin } as unknown as postgres.Sql, unsafe, begin, tx };
}

describe('postgresExecutor.query', () => {
  test('sends the text with its parameters and returns the rows', async () => {
    const { sql, unsafe } = fakeSql([{ n: 1 }]);
    const params = ['a', 2, null] as const;
    await expect(postgresExecutor(sql).query('select $1, $2, $3', params)).resolves.toEqual([
      { n: 1 },
    ]);
    expect(unsafe).toHaveBeenCalledExactlyOnceWith('select $1, $2, $3', ['a', 2, null]);
    // A copy goes to the driver, never the caller's array.
    expect(unsafe.mock.calls[0]?.[1]).not.toBe(params);
  });

  test('defaults to no parameters', async () => {
    const { sql, unsafe } = fakeSql();
    await postgresExecutor(sql).query('select 1');
    expect(unsafe).toHaveBeenCalledExactlyOnceWith('select 1', []);
  });
});

describe('postgresExecutor.transaction', () => {
  test('on the pool it opens one transaction and runs everything on that connection', async () => {
    const { sql, unsafe, begin, tx } = fakeSql();
    const result = await postgresExecutor(sql).transaction(async (inner) => {
      await inner.query('select 1');
      return 'done';
    });
    expect(result).toBe('done');
    expect(begin).toHaveBeenCalledTimes(1);
    expect(unsafe).toHaveBeenCalledTimes(1);
    expect(tx.unsafe).toBe(unsafe);
  });

  test('inside a transaction it reuses that transaction instead of opening another', async () => {
    const { sql, begin } = fakeSql();
    const order: string[] = [];
    await postgresExecutor(sql).transaction(async (outer) => {
      order.push('outer');
      await outer.transaction(async (nested) => {
        order.push('nested');
        await nested.query('select 1');
      });
    });
    expect(order).toEqual(['outer', 'nested']);
    expect(begin).toHaveBeenCalledTimes(1);
  });

  test('an error in the callback rejects the transaction', async () => {
    const { sql, begin } = fakeSql();
    begin.mockImplementation(async (run) => run({ unsafe: vi.fn() } as never));
    const boom = new Error('boom');
    await expect(
      postgresExecutor(sql).transaction(async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });
});

describe('applyMigrations through postgresExecutor', () => {
  const client = new PGlite();
  const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

  // A postgres.js look-alike whose transactions are PGlite transactions.
  const runnerOver = (target: Pick<PGlite, 'query'>) => ({
    unsafe: async (text: string, params: unknown[]) => (await target.query<Row>(text, params)).rows,
  });
  const pool = {
    ...runnerOver(client),
    begin: <T>(run: (tx: ReturnType<typeof runnerOver>) => Promise<T>) =>
      client.transaction((tx) => run(runnerOver(tx))),
  } as unknown as postgres.Sql;

  const executor = postgresExecutor(pool);
  let firstRun: { applied: number };

  // PGlite boots a WASM Postgres: give the slow first start (and a loaded CI box) room.
  beforeAll(async () => {
    // What infra/postgres/init.sql sets up.
    await client.exec('create role dashboard; create role c15t_api; create schema app;');
    firstRun = await applyMigrations(executor, { migrationsFolder });
  }, 60_000);

  afterAll(async () => {
    await client.close();
  });

  test('applies every migration through the adapter and records them in the journal', async () => {
    expect(firstRun).toEqual({ applied: 2 });
    const journal = await executor.query('select count(*)::int as n from app.__drizzle_migrations');
    expect(journal).toEqual([{ n: 2 }]);
    const tables = await executor.query(
      "select table_name from information_schema.tables where table_schema = 'app' and table_name = 'site'",
    );
    expect(tables).toEqual([{ table_name: 'site' }]);
  });

  test('a second run finds nothing left to apply', async () => {
    await expect(applyMigrations(executor, { migrationsFolder })).resolves.toEqual({ applied: 0 });
  });
});
