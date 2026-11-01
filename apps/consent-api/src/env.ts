// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { cidrListSchema, hostSchema, portSchema } from '@consent/shared';
import { z } from 'zod';

/*
 * The only module that reads `process.env` (CLAUDE.md "Code conventions"). Network defaults
 * live here and nowhere else. The bind-address and proxy rules come from @consent/shared.
 */

function isPostgresUrl(value: string): boolean {
  try {
    const { protocol, hostname } = new URL(value);
    return (protocol === 'postgres:' || protocol === 'postgresql:') && hostname !== '';
  } catch {
    return false;
  }
}

// The messages never echo the value: these are secrets.
const postgresUrlSchema = z
  .string()
  .trim()
  .refine(isPostgresUrl, 'Must be a postgres:// or postgresql:// URL with a host');

const poolSizeSchema = z.coerce.number().int().min(1).max(3);

const booleanSchema = z.enum(['true', 'false']).transform((value) => value === 'true');

const envSchema = z.object({
  CONSENT_API_HOST: hostSchema.prefault('127.0.0.1'),
  CONSENT_API_PORT: portSchema.prefault('4100'),
  CONSENT_API_TRUSTED_PROXIES: cidrListSchema.prefault('127.0.0.1/32,::1/128'),
  /** Role `c15t_api`, primary by internal DNS name. Also used for the site registry. */
  DATABASE_URL_C15T: postgresUrlSchema,
  C15T_ADMIN_API_KEY: z.string().min(16, 'Must be at least 16 characters'),
  /** Connections per c15t instance (one instance per site). CLAUDE.md: 2 to 3. */
  CONSENT_API_INSTANCE_POOL_MAX: poolSizeSchema.prefault('2'),
  /** Connections for the site registry and `/status`. */
  CONSENT_API_REGISTRY_POOL_MAX: poolSizeSchema.prefault('2'),
  /** Set `false` behind PgBouncer in transaction mode: prepared statements break there. */
  CONSENT_API_DB_PREPARE: booleanSchema.prefault('true'),
});

export type Env = z.output<typeof envSchema>;

function indentLines(lines: readonly string[]): string {
  return lines.map((line) => `  ${line}`).join('\n');
}

export class EnvError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid environment:\n${indentLines(issues)}`);
    this.name = 'EnvError';
    this.issues = issues;
  }
}

export function parseEnv(source: Readonly<Record<string, string | undefined>>): Env {
  // An empty value (`KEY=` in an EnvironmentFile) counts as unset, so the default applies.
  const present = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const result = envSchema.safeParse(present);
  if (result.success) return result.data;
  throw new EnvError(
    result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
  );
}

export function loadEnv(): Env {
  return parseEnv(process.env);
}
