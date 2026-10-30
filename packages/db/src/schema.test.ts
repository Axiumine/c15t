// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { createRequire } from 'node:module';
import { type Column, getTableColumns, getTableName } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, test } from 'vitest';
import { account, authSchema, rateLimit, session, user, verification } from './schema.js';

/*
 * Drift guard: Better Auth's Drizzle adapter reads and writes columns by the TypeScript key of
 * each field. If a Better Auth upgrade adds or renames a field, this fails before runtime does.
 */
const require = createRequire(import.meta.url);

interface AuthField {
  readonly required?: boolean;
  readonly defaultValue?: unknown;
  readonly unique?: boolean;
  readonly references?: { readonly model: string };
}
type AuthTables = Record<string, { modelName: string; fields: Record<string, AuthField> }>;

async function loadAuthTables(): Promise<AuthTables> {
  const { getAuthTables } = (await import(require.resolve('better-auth/db'))) as {
    getAuthTables: (options: object) => AuthTables;
  };
  const { admin } = (await import(require.resolve('better-auth/plugins'))) as {
    admin: () => unknown;
  };
  return getAuthTables({
    plugins: [admin()],
    rateLimit: { storage: 'database' },
    user: {
      additionalFields: {
        mustChangePassword: { type: 'boolean', required: false, defaultValue: false, input: false },
      },
    },
  });
}

function expectColumnFits(label: string, column: Column | undefined, definition: AuthField): void {
  expect(column, label).toBeDefined();
  if (column === undefined) return;
  // Required fields without a default must not be nullable on our side.
  const needsValue = definition.required !== false && definition.defaultValue === undefined;
  if (needsValue) expect(column.notNull, `${label} must be NOT NULL`).toBe(true);
  if (definition.unique === true) expect(column.isUnique, `${label} must be unique`).toBe(true);
}

const OUR_TABLES: Record<string, PgTable> = { user, session, account, verification, rateLimit };

test('authSchema exposes exactly the Better Auth tables', () => {
  expect(authSchema).toEqual(OUR_TABLES);
});

describe('app schema vs Better Auth', async () => {
  const authTables = await loadAuthTables();

  test('covers exactly the tables Better Auth needs', () => {
    expect(Object.keys(authTables).sort()).toEqual(Object.keys(OUR_TABLES).sort());
  });

  for (const [key, authTable] of Object.entries(authTables)) {
    const ours = OUR_TABLES[key];
    if (ours === undefined) continue;

    test(`${key}: every Better Auth field has a column`, () => {
      const columns = getTableColumns(ours);
      expect(Object.keys(columns)).toContain('id');
      for (const [field, definition] of Object.entries(authTable.fields)) {
        expectColumnFits(`${key}.${field}`, columns[field], definition);
      }
    });

    test(`${key}: no column Better Auth does not know about`, () => {
      const known = new Set(['id', ...Object.keys(authTable.fields)]);
      for (const field of Object.keys(getTableColumns(ours))) {
        expect(known.has(field), `${getTableName(ours)}.${field}`).toBe(true);
      }
    });
  }
});
