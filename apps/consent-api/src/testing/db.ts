// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { createPool } from '@consent/db';
import type postgres from 'postgres';

/*
 * Real-database tests. They fail loudly, and never skip, when the environment is missing: a
 * green run must mean the database was exercised. Yarn injects the variables from the dev env
 * file, so run them as `yarn vitest run --project consent-api`. Not as
 * `yarn workspace @consent/consent-api test`: that workspace does not list `vitest`.
 */

export interface IntegrationEnv {
  /** Role `c15t_api`: what consent-api runs as. */
  readonly c15tUrl: string;
  /** Role `dashboard`: owns `app`, so it creates and edits the test sites. */
  readonly dashboardUrl: string;
  readonly apiKey: string;
}

export function integrationEnv(): IntegrationEnv {
  const c15tUrl = process.env['DATABASE_URL_C15T'];
  const dashboardUrl = process.env['DATABASE_URL_DASHBOARD'];
  const apiKey = process.env['C15T_ADMIN_API_KEY'];
  const missing = [
    ['DATABASE_URL_C15T', c15tUrl],
    ['DATABASE_URL_DASHBOARD', dashboardUrl],
    ['C15T_ADMIN_API_KEY', apiKey],
  ]
    .filter(([, value]) => value === undefined || value === '')
    .map(([name]) => name);
  if (
    c15tUrl === undefined ||
    dashboardUrl === undefined ||
    apiKey === undefined ||
    missing.length > 0
  ) {
    throw new Error(
      `The consent-api integration tests need ${missing.join(', ')}. They are not skipped: run them with ` +
        '`yarn vitest run --project consent-api` so Yarn injects the dev env file.',
    );
  }
  return { c15tUrl, dashboardUrl, apiKey };
}

export function testPool(url: string, name: string): postgres.Sql {
  return createPool({ url, role: 'primary', applicationName: name, max: 1 });
}

/**
 * Deletes the consent data of the given tenants from every `c15t` table that has a `tenantId`
 * column. Foreign keys decide the order, so a table that is still referenced is retried on the
 * next pass. Only ever pass keys this run generated.
 */
export async function deleteTenantData(
  sql: postgres.Sql,
  tenantIds: readonly string[],
): Promise<void> {
  const tables = await sql<{ table_name: string }[]>`
    select table_name from information_schema.columns
    where table_schema = 'c15t' and column_name = 'tenantId'`;
  let pending = tables.map((row) => row.table_name);
  for (let pass = 0; pass < 5 && pending.length > 0; pass++) {
    const failed: string[] = [];
    for (const table of pending) {
      try {
        await sql`delete from c15t.${sql(table)} where "tenantId" in ${sql([...tenantIds])}`;
      } catch (error) {
        if ((error as { code?: string }).code !== '23503') throw error;
        failed.push(table);
      }
    }
    pending = failed;
  }
  if (pending.length > 0) throw new Error(`Could not clean up ${pending.join(', ')}`);
}
