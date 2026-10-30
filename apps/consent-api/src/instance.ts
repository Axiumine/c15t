// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import * as net from 'node:net';
import {
  type C15TInstance,
  type C15TOptions,
  c15tInstance,
  policyRulePresets,
} from '@c15t/backend';
import { POLICY_PRESET_RULES, trustedOriginsSchema } from '@consent/shared';
import { PgClient } from '@effect/sql-pg';
import { Duration, Redacted } from 'effect';
import { SiteConfigError } from './errors.js';
import type { SiteRecord } from './site-store.js';

type DatabaseOption = C15TOptions['database'];
type PolicyRules = NonNullable<NonNullable<C15TOptions['manifest']>['policyRules']>;

export interface InstanceDatabaseConfig {
  /** `DATABASE_URL_C15T`: role `c15t_api` on the primary. */
  readonly url: string;
  /** Connections per instance. */
  readonly poolMax: number;
  /** Set `false` behind PgBouncer in transaction mode. */
  readonly prepare: boolean;
  /** Connections older than this are replaced, so they leave a demoted node (README D9). */
  readonly maxLifetimeSeconds: number;
}

export interface InstanceConfig {
  readonly apiKey: string;
  readonly database: InstanceDatabaseConfig;
}

const CONNECT_TIMEOUT_SECONDS = 5;
const IDLE_TIMEOUT_SECONDS = 30;
const KEEP_ALIVE_DELAY_MS = 30_000;
const SCHEMA = 'c15t';

/**
 * The c15t pool for one site, in place of `database: { dialect, url }` because that form has no
 * pool size, lifetime or keepalive. It repeats what that form adds: the `c15t` search path and a
 * UTC session (c15t stores UTC wall clocks and relies on it).
 *
 * @effect/sql-pg 4.0.0 has no `target_session_attrs`, so a connection on a demoted node is only
 * caught by `connectionTTL` and by the registry dropping the instance after a database error. It
 * has no keepalive either: the `stream` factory below supplies one. Node resolves the host on
 * every connect, so a repointed Patroni DNS name is picked up by the next connection.
 */
export function createDatabaseLayer(config: InstanceDatabaseConfig): DatabaseOption {
  const url = new URL(config.url);
  const hostname = url.hostname.replace(/^\[(.*)\]$/, '$1');
  const port = url.port === '' ? 5432 : Number(url.port);
  // A `?host=` parameter points at a unix socket directory, which the stream below cannot dial.
  const useStream = hostname !== '' && !url.searchParams.has('host');
  return PgClient.layer({
    url: Redacted.make(config.url),
    applicationName: 'consent-api',
    maxConnections: config.poolMax,
    minConnections: 0,
    idleTimeout: Duration.seconds(IDLE_TIMEOUT_SECONDS),
    connectionTTL: Duration.seconds(config.maxLifetimeSeconds),
    connectTimeout: Duration.seconds(CONNECT_TIMEOUT_SECONDS),
    startupParameters: { search_path: SCHEMA, timezone: 'UTC' },
    prepare: config.prepare,
    ...(useStream
      ? {
          stream: () =>
            net.connect({
              host: hostname,
              port,
              noDelay: true,
              keepAlive: true,
              keepAliveInitialDelay: KEEP_ALIVE_DELAY_MS,
            }),
        }
      : {}),
  });
}

/**
 * In c15t 3.1.0 an empty `trustedOrigins` only changes CORS (no origin is allowed), and `*` and
 * `*.example.com` are honoured. The platform allows neither an empty list nor a wildcard
 * (CLAUDE.md "Multi-tenancy"), whatever the database says.
 */
export function assertTrustedOrigins(siteKey: string, origins: readonly string[]): string[] {
  if (origins.length === 0) {
    throw new SiteConfigError(siteKey, 'trustedOrigins must not be empty');
  }
  if (origins.some((origin) => origin.includes('*'))) {
    throw new SiteConfigError(siteKey, 'trustedOrigins must not contain wildcards');
  }
  const parsed = trustedOriginsSchema.safeParse([...origins]);
  if (!parsed.success) {
    throw new SiteConfigError(siteKey, 'trustedOrigins contains an invalid host name');
  }
  return parsed.data;
}

export function policyRulesFor(site: SiteRecord): PolicyRules {
  const presets = policyRulePresets as unknown as Record<
    string,
    (() => PolicyRules[number]) | undefined
  >;
  return POLICY_PRESET_RULES[site.policyPreset].map((name) => {
    const rule = Object.hasOwn(presets, name) ? presets[name] : undefined;
    if (rule === undefined) {
      throw new SiteConfigError(site.key, `Unknown policy rule preset "${name}"`);
    }
    return rule();
  });
}

/**
 * The options of CLAUDE.md "Multi-tenancy". `requireTenantId` is what makes a bad lookup fail
 * loudly instead of writing consents with a null tenant.
 */
export function buildInstanceOptions(
  site: SiteRecord,
  config: { readonly apiKey: string; readonly database: DatabaseOption },
): C15TOptions {
  return {
    database: config.database,
    basePath: `/s/${site.key}`,
    tenantId: site.key,
    requireTenantId: true,
    trustedOrigins: assertTrustedOrigins(site.key, site.domains),
    manifest: { policyRules: policyRulesFor(site) },
    apiKeys: [config.apiKey],
    // nginx sets X-Forwarded-For from the real visitor IP; consent-api reduces it to one address.
    ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
    // The browser reaches this backend through the site's own vhost, never through /s/<key>.
    script: { backendURL: '/api/c15t' },
    // Nothing needs the spec, and the instance is reachable from every site's domain.
    openapi: { enabled: false },
  };
}

export function createSiteInstance(site: SiteRecord, config: InstanceConfig): C15TInstance {
  return c15tInstance(
    buildInstanceOptions(site, {
      apiKey: config.apiKey,
      database: createDatabaseLayer(config.database),
    }),
  );
}
