// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { z } from 'zod';
import { noNul } from './text.js';

export const SITE_KEY_PATTERN = /^[a-z0-9-]{3,40}$/;

/** URL segment and c15t `tenantId`. Immutable after creation. */
export const siteKeySchema = z
  .string()
  .regex(SITE_KEY_PATTERN, 'siteKey must be 3 to 40 characters: a-z, 0-9 and hyphen');
export type SiteKey = z.infer<typeof siteKeySchema>;

const HOST_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const DOMAIN_PATTERN = new RegExp(`^${HOST_LABEL}(?:\\.${HOST_LABEL})*(?::[0-9]{1,5})?$`);

/**
 * A website host as the browser sends it: lowercase `host` or `host:port`, no scheme, path or
 * wildcard. It is both the `Host` allowlist entry and the c15t `trustedOrigins` entry (c15t
 * matches a hostname on any web scheme and pins a port when one is given).
 */
export const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .refine((value) => !value.includes('*'), 'Wildcards are not allowed')
  .refine((value) => DOMAIN_PATTERN.test(value), 'Must be a host name such as shop.example.com')
  .refine((value) => {
    const port = value.split(':')[1];
    return port === undefined || (Number(port) >= 1 && Number(port) <= 65535);
  }, 'Port must be between 1 and 65535');

export const MAX_DOMAINS_PER_SITE = 50;

/**
 * Non-empty, unique list of domains. An empty list or `*` must never reach c15t, so consent-api
 * validates its `trustedOrigins` (the same values) with this schema too.
 */
export const domainsSchema = z
  .array(domainSchema)
  .min(1, 'At least one domain is required')
  .max(MAX_DOMAINS_PER_SITE)
  .refine((list) => new Set(list).size === list.length, 'Domains must be unique');
export type Domains = z.infer<typeof domainsSchema>;

export const POLICY_PRESETS = ['eu-opt-in', 'eu-us-opt-out', 'global-preferences'] as const;
export const policyPresetSchema = z.enum(POLICY_PRESETS);
export type PolicyPreset = z.infer<typeof policyPresetSchema>;
export const DEFAULT_POLICY_PRESET: PolicyPreset = 'eu-opt-in';

/**
 * Names of the `policyRulePresets` factories in @c15t/backend that make up each preset, in
 * match order. consent-api builds `manifest.policyRules` from this list. Starting points only:
 * which laws apply to a website is a legal decision (README open questions).
 */
export const POLICY_PRESET_RULES: Readonly<Record<PolicyPreset, readonly string[]>> = {
  'eu-opt-in': ['europeOptIn', 'worldNone'],
  'eu-us-opt-out': ['europeOptIn', 'quebecOptIn', 'usPrivacyStatesOptOut', 'worldNone'],
  'global-preferences': [
    'europeOptIn',
    'quebecOptIn',
    'usPrivacyStatesOptOut',
    'worldOptOutNoPrompt',
  ],
};

export const POLICY_PRESET_LABELS: Readonly<Record<PolicyPreset, string>> = {
  'eu-opt-in': 'EU, UK and unknown locations: opt-in. No banner elsewhere',
  'eu-us-opt-out': 'EU, UK and Quebec: opt-in. US states: opt-out. No banner elsewhere',
  'global-preferences': 'As above, but preferences stay reachable everywhere',
};

/** The c15t consent categories (`necessary` is always on). */
export const CONSENT_CATEGORIES = [
  'necessary',
  'functionality',
  'measurement',
  'experience',
  'marketing',
] as const;

/**
 * What the generated banner script tag declares in `data-categories`. c15t v3 offers only the
 * categories it can discover from the page's gated scripts, so a page without any records only
 * `necessary` on "Accept All" and the per-purpose opt-in rates stay empty. A site does not store
 * its categories, so the tag carries the common pair and the Setup screen tells the operator to
 * list the ones the site really uses.
 */
export const DEFAULT_BANNER_CATEGORIES = ['measurement', 'marketing'] as const;

export const SITE_STATUSES = ['active', 'disabled'] as const;
export const siteStatusSchema = z.enum(SITE_STATUSES);
export type SiteStatus = z.infer<typeof siteStatusSchema>;

export const siteNameSchema = noNul(z.string().trim().min(1).max(120));

const isoDateTime = z.iso.datetime({ offset: true });

export const siteCreateSchema = z.strictObject({
  key: siteKeySchema,
  name: siteNameSchema,
  domains: domainsSchema,
  policyPreset: policyPresetSchema.default(DEFAULT_POLICY_PRESET),
});
export type SiteCreateInput = z.input<typeof siteCreateSchema>;
export type SiteCreate = z.output<typeof siteCreateSchema>;

/** `key` is absent on purpose: the strict object rejects any attempt to change it. */
export const siteUpdateSchema = z
  .strictObject({
    name: siteNameSchema.optional(),
    domains: domainsSchema.optional(),
    policyPreset: policyPresetSchema.optional(),
    status: siteStatusSchema.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to change',
  });
export type SiteUpdate = z.infer<typeof siteUpdateSchema>;

export const siteSchema = z.object({
  key: siteKeySchema,
  name: siteNameSchema,
  domains: domainsSchema,
  policyPreset: policyPresetSchema,
  status: siteStatusSchema,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Site = z.infer<typeof siteSchema>;

/** Copy-paste setup text that `GET /api/sites/:siteKey` returns for the Setup screen. */
export const siteSetupSchema = z.object({
  nginx: z.string(),
  backendUrl: z.string(),
  scriptTag: z.string(),
  serverClient: z.string(),
});
export type SiteSetup = z.infer<typeof siteSetupSchema>;

export const siteDetailSchema = siteSchema.extend({ setup: siteSetupSchema });
export type SiteDetail = z.infer<typeof siteDetailSchema>;
