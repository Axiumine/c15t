// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { type C15TInstance, type C15TOptions, c15tInstance } from '@c15t/backend';
import { assertTrustedOrigins, policyRulesFor } from './instance-checks.js';
import {
  createDatabaseLayer,
  type DatabaseOption,
  type InstanceDatabaseConfig,
} from './instance-database.js';
import type { SiteRecord } from './site-store.js';

export interface InstanceConfig {
  readonly apiKey: string;
  readonly database: InstanceDatabaseConfig;
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
