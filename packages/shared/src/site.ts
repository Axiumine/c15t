// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { z } from 'zod';
import { domainsSchema } from './domain.js';
import { isoDateTime } from './iso-datetime.js';
import { DEFAULT_POLICY_PRESET, policyPresetSchema } from './policy.js';
import { noNul } from './text.js';

export const SITE_KEY_PATTERN = /^[a-z0-9-]{3,40}$/;

/** URL segment and c15t `tenantId`. Immutable after creation. */
export const siteKeySchema = z
  .string()
  .regex(SITE_KEY_PATTERN, 'siteKey must be 3 to 40 characters: a-z, 0-9 and hyphen');
export type SiteKey = z.infer<typeof siteKeySchema>;

export const SITE_STATUSES = ['active', 'disabled'] as const;
export const siteStatusSchema = z.enum(SITE_STATUSES);
export type SiteStatus = z.infer<typeof siteStatusSchema>;

export const siteNameSchema = noNul(z.string().trim().min(1).max(120));

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
