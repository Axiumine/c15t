// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { domainsSchema, policyPresetSchema, siteKeySchema, siteNameSchema } from '@consent/shared';
import { z } from 'zod';

/** One domain per line; commas and spaces also separate, because people paste lists. */
export function parseDomainList(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/**
 * The textarea holds one string, so list-level and per-domain problems are all reported on the
 * `domains` field, naming the offending domain.
 */
const domainsFieldSchema = z.string().transform((text, ctx) => {
  const list = parseDomainList(text);
  const result = domainsSchema.safeParse(list);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    const index = issue.path[0];
    const culprit = typeof index === 'number' ? list.at(index) : undefined;
    ctx.addIssue({
      code: 'custom',
      message: culprit === undefined ? issue.message : `${culprit}: ${issue.message}`,
    });
  }
  return z.NEVER;
});

/** Built from the shared field schemas, so the form accepts exactly what the API accepts. */
export const siteFormSchema = z.object({
  key: siteKeySchema,
  name: siteNameSchema,
  domains: domainsFieldSchema,
  policyPreset: policyPresetSchema,
});

export type SiteFormInput = z.input<typeof siteFormSchema>;
export type SiteFormValues = z.output<typeof siteFormSchema>;
