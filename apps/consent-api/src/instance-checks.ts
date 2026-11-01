// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { type C15TOptions, policyRulePresets } from '@c15t/backend';
import { domainsSchema, POLICY_PRESET_RULES } from '@consent/shared';
import { SiteConfigError } from './errors.js';
import type { SiteRecord } from './site-store.js';

type PolicyRules = NonNullable<NonNullable<C15TOptions['manifest']>['policyRules']>;

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
  const parsed = domainsSchema.safeParse([...origins]);
  if (!parsed.success) {
    throw new SiteConfigError(siteKey, 'trustedOrigins contains an invalid host name');
  }
  return parsed.data;
}

export function policyRulesFor(site: SiteRecord): PolicyRules {
  const presets = new Map<string, () => PolicyRules[number]>(Object.entries(policyRulePresets));
  return POLICY_PRESET_RULES[site.policyPreset].map((name) => {
    const rule = presets.get(name);
    if (rule === undefined) {
      throw new SiteConfigError(site.key, `Unknown policy rule preset "${name}"`);
    }
    return rule();
  });
}
