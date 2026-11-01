// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import type { Runtime } from './runtime.js';

/*
 * Cleanup of one run in the shared development database. Every statement is keyed on the exact
 * run id (`e2e-<8 hex>-`) with `starts_with`, never on a short prefix, and runs inside one
 * transaction. Nothing is truncated or dropped. `app.admin_audit` is append-only by design (a
 * trigger rejects DELETE), so the audit rows of a run stay; they hold only run-prefixed names.
 */

function requiredUrl(name: 'DATABASE_URL_DASHBOARD' | 'DATABASE_URL_C15T'): string {
  // eslint-disable-next-line security/detect-object-injection -- `name` is one of two literal variable names
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set: run the suite with \`yarn test:e2e\` (see docs/e2e.md)`);
  }
  return value;
}

/** Fails fast, before any server starts, when the database settings are missing. */
export function assertDatabaseEnv(): void {
  requiredUrl('DATABASE_URL_DASHBOARD');
  requiredUrl('DATABASE_URL_C15T');
  for (const name of ['BETTER_AUTH_SECRET', 'C15T_ADMIN_API_KEY']) {
    // eslint-disable-next-line security/detect-object-injection -- `name` comes from the literal list above
    if ((process.env[name] ?? '') === '') throw new Error(`${name} is not set`);
  }
}

function open(url: string) {
  // One connection each: max_connections is shared with every other developer and agent.
  return postgres(url, { max: 1, connect_timeout: 10, idle_timeout: 5, onnotice: () => {} });
}

/** Client addresses the run used for rate limiting; appended by the browser contexts. */
const clientIpFile = (rt: Runtime) => resolve(rt.runDir, 'client-ips.txt');

export function recordClientIp(rt: Runtime, ip: string): void {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a file inside the run's own scratch directory
  appendFileSync(clientIpFile(rt), `${ip}\n`);
}

function recordedClientIps(rt: Runtime): string[] {
  const file = clientIpFile(rt);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- a file inside the run's own scratch directory
  if (!existsSync(file)) return [];
  return [
    ...new Set(
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- a file inside the run's own scratch directory
      readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line !== ''),
    ),
  ];
}

export interface CleanupReport {
  readonly sites: number;
  readonly users: number;
  readonly consents: number;
}

export async function cleanupRun(rt: Runtime): Promise<CleanupReport> {
  const prefix = `${rt.runId}-`;
  const ips = recordedClientIps(rt);
  const c15t = open(requiredUrl('DATABASE_URL_C15T'));
  const app = open(requiredUrl('DATABASE_URL_DASHBOARD'));
  try {
    // Consent data first (role c15t_api owns the c15t schema). Child tables before parents.
    const consents = await c15t.begin(async (tx) => {
      await tx`delete from c15t."auditLog" where starts_with("tenantId", ${prefix})`;
      const removed = await tx`delete from c15t."consent" where starts_with("tenantId", ${prefix})`;
      await tx`delete from c15t."runtimePolicyDecision" where starts_with("tenantId", ${prefix})`;
      await tx`delete from c15t."consentPolicy" where starts_with("tenantId", ${prefix})`;
      await tx`delete from c15t."domain" where starts_with("tenantId", ${prefix})`;
      await tx`delete from c15t."subject" where starts_with("tenantId", ${prefix})`;
      await tx`delete from c15t."consentPurpose" where starts_with("tenantId", ${prefix})`;
      return removed.count;
    });
    return await app.begin(async (tx) => {
      // Sessions, accounts and memberships go with the user (ON DELETE CASCADE).
      const users = await tx`delete from app."user" where starts_with(email, ${prefix})`;
      const sites = await tx`delete from app."site" where starts_with("key", ${prefix})`;
      if (ips.length > 0) {
        // Better Auth keys the limiter as `<client ip>|<path>`; the addresses are random per context.
        await tx`delete from app."rate_limit" where split_part("key", '|', 1) = any(${ips})`;
      }
      return { sites: sites.count, users: users.count, consents };
    });
  } finally {
    await Promise.all([c15t.end({ timeout: 5 }), app.end({ timeout: 5 })]);
  }
}
