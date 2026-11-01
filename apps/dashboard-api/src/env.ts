// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { hostSchema, originSchema, portSchema } from '@consent/shared';
import { z } from 'zod';

/*
 * The only module that reads `process.env` (CLAUDE.md "Code conventions"). Defaults for the bind
 * address and port live here and nowhere else. Error messages name variables, never values.
 */

function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname !== '';
  } catch {
    return false;
  }
}

const postgresUrl = z
  .string()
  .trim()
  .refine(isPostgresUrl, 'Must be a postgres:// or postgresql:// URL with a host');

/** An empty value in the env file means "not set". */
function emptyIsUnset<S extends z.ZodType>(schema: S) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema.optional(),
  );
}

const optionalPostgresUrl = emptyIsUnset(postgresUrl);

const envSchema = z.object({
  DASHBOARD_API_HOST: hostSchema.default('127.0.0.1'),
  DASHBOARD_API_PORT: portSchema.default(4200),
  /** Role `dashboard`, primary by internal DNS name (README D9). */
  DATABASE_URL_DASHBOARD: postgresUrl,
  /** Optional replica endpoint, used only for read-only analytics over `c15t.*`. */
  DATABASE_URL_DASHBOARD_REPLICA: optionalPostgresUrl,
  /**
   * Reserved for @c15t/node-sdk calls (README D4), which dashboard-api does not make yet. Both
   * are optional so that this process does not need the key that can call key-protected c15t
   * endpoints. When set, they are validated: the URL must be a bare origin.
   */
  CONSENT_API_URL: emptyIsUnset(originSchema),
  C15T_ADMIN_API_KEY: emptyIsUnset(z.string().min(1)),
  BETTER_AUTH_SECRET: z.string().min(32, 'Must be at least 32 characters'),
  BETTER_AUTH_URL: originSchema,
});
export type Env = z.output<typeof envSchema>;

/** What the admin CLI needs: it never listens on a port or talks to consent-api. */
const cliEnvSchema = envSchema.pick({
  DATABASE_URL_DASHBOARD: true,
  BETTER_AUTH_SECRET: true,
  BETTER_AUTH_URL: true,
});
export type CliEnv = z.output<typeof cliEnvSchema>;

export class EnvError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid environment:\n${problems.map((problem) => `  ${problem}`).join('\n')}`);
    this.name = 'EnvError';
    this.problems = problems;
  }
}

export type EnvSource = Readonly<Record<string, string | undefined>>;

function parseWith<S extends z.ZodType>(schema: S, source: EnvSource): z.output<S> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  throw new EnvError(
    result.error.issues.map((issue) => `${issue.path.join('.') || '(env)'}: ${issue.message}`),
  );
}

export function parseEnv(source: EnvSource): Env {
  return parseWith(envSchema, source);
}

export function parseCliEnv(source: EnvSource): CliEnv {
  return parseWith(cliEnvSchema, source);
}

export function loadEnv(): Env {
  return parseEnv(process.env);
}

export function loadCliEnv(): CliEnv {
  return parseCliEnv(process.env);
}
