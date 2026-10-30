// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { retryRead } from '@consent/db';
import {
  type PolicyPreset,
  policyPresetSchema,
  type SiteStatus,
  siteStatusSchema,
} from '@consent/shared';
import type postgres from 'postgres';
import { z } from 'zod';

/** One `app.site` row, as consent-api needs it. */
export interface SiteRecord {
  /** Immutable. URL segment and c15t `tenantId`. */
  readonly key: string;
  readonly domains: readonly string[];
  readonly policyPreset: PolicyPreset;
  readonly status: SiteStatus;
}

export interface SiteStore {
  /** `null` when no row has this key. A disabled site is returned with its status. */
  find: (key: string) => Promise<SiteRecord | null>;
  /** Rejects when the registry table or the c15t schema is not reachable. */
  check: () => Promise<{ readonly activeSites: number }>;
}

const rowSchema = z.object({
  key: z.string(),
  domains: z.array(z.string()),
  policy_preset: policyPresetSchema,
  status: siteStatusSchema,
});

const checkSchema = z.object({ schema_ok: z.boolean(), active_sites: z.number() });

/**
 * Reads the site registry with the `c15t_api` role, which has SELECT on `app.site` and nothing
 * else in `app` (README D2). `sql` must be a primary pool: after a failover the registry has to
 * see the new leader's data, and `NOTIFY` is only delivered there. Lookups are idempotent reads,
 * so they retry once after a failover error.
 */
export function createPgSiteStore(sql: postgres.Sql): SiteStore {
  return {
    async find(key) {
      const rows = await retryRead(
        () =>
          sql`select key, domains, policy_preset, status from app.site where key = ${key} limit 1`,
      );
      const row = rows[0];
      if (row === undefined) return null;
      const parsed = rowSchema.parse(row);
      return {
        key: parsed.key,
        domains: parsed.domains,
        policyPreset: parsed.policy_preset,
        status: parsed.status,
      };
    },

    async check() {
      const rows = await retryRead(
        () => sql`
          select to_regclass('c15t.subject') is not null as schema_ok,
                 (select count(*)::int from app.site where status = 'active') as active_sites`,
      );
      const parsed = checkSchema.parse(rows[0]);
      if (!parsed.schema_ok) throw new Error('The c15t schema is missing; run yarn c15t:migrate');
      return { activeSites: parsed.active_sites };
    },
  };
}
