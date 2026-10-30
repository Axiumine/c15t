// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { z } from 'zod';
import { pageQuerySchema, pageSchema } from './pagination.js';
import { isRepresentableInstant, noNul } from './text.js';

const isoDateTime = z.iso.datetime({ offset: true });

/**
 * `from` and `to` accept a calendar date or a full timestamp. The instant must fall in the years
 * 0001 to 9999 (UTC), which is what Postgres accepts. An upper bound at the very end of that
 * range is rejected later by the API, because it is widened by one day (date) or one
 * millisecond (timestamp).
 */
export const rangeBoundSchema = z
  .union([z.iso.date(), isoDateTime])
  .refine(
    (value) => isRepresentableInstant(Date.parse(value)),
    'Must be between the years 0001 and 9999',
  );

export const MAX_RANGE_DAYS = 366;

const rangeShape = {
  from: rangeBoundSchema.optional(),
  to: rangeBoundSchema.optional(),
};

function rangeIsOrdered(value: { from?: string | undefined; to?: string | undefined }): boolean {
  if (value.from === undefined || value.to === undefined) return true;
  return Date.parse(value.from) <= Date.parse(value.to);
}

const rangeOrdered = { message: '`from` must not be after `to`', path: ['from'] };

/** `GET /api/sites/:siteKey/stats?from&to`. Defaults (last 30 days) are applied by the API. */
export const statsQuerySchema = z.object(rangeShape).refine(rangeIsOrdered, rangeOrdered);
export type StatsQuery = z.infer<typeof statsQuerySchema>;

/** `GET /api/sites/:siteKey/consents?subject&from&to&cursor&limit` */
export const consentListQuerySchema = pageQuerySchema
  .extend({ subject: noNul(z.string().trim().min(1).max(200)).optional(), ...rangeShape })
  .refine(rangeIsOrdered, rangeOrdered);
export type ConsentListQuery = z.output<typeof consentListQuerySchema>;

/** `GET /api/sites/:siteKey/consents.csv?from&to` */
export const consentExportQuerySchema = z.object(rangeShape).refine(rangeIsOrdered, rangeOrdered);
export type ConsentExportQuery = z.infer<typeof consentExportQuerySchema>;

/** One consent decision, flattened from c15t `consent` + `subject` + `domain` + decision tables. */
export const consentRecordSchema = z.object({
  id: z.string(),
  subjectId: z.string(),
  externalId: z.string().nullable(),
  domain: z.string().nullable(),
  givenAt: isoDateTime,
  validUntil: isoDateTime.nullable(),
  /** Category code to granted, e.g. `{ measurement: true, marketing: false }`. */
  purposes: z.record(z.string(), z.boolean()),
  consentAction: z.string().nullable(),
  jurisdiction: z.string().nullable(),
  jurisdictionModel: z.string().nullable(),
  countryCode: z.string().nullable(),
  regionCode: z.string().nullable(),
  uiSource: z.string().nullable(),
  /** As stored by c15t, which masks it unless `ipAddress.tracking` is on. */
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
});
export type ConsentRecord = z.infer<typeof consentRecordSchema>;

export const consentPageSchema = pageSchema(consentRecordSchema);
export type ConsentPage = z.infer<typeof consentPageSchema>;

/** Column order of the CSV export. */
export const CONSENT_CSV_COLUMNS = [
  'id',
  'subjectId',
  'externalId',
  'domain',
  'givenAt',
  'validUntil',
  'purposes',
  'consentAction',
  'jurisdiction',
  'jurisdictionModel',
  'countryCode',
  'regionCode',
  'uiSource',
  'ipAddress',
  'userAgent',
] as const satisfies readonly (keyof ConsentRecord)[];

const rate = z.number().min(0).max(1);

export const statsResponseSchema = z.object({
  range: z.object({ from: isoDateTime, to: isoDateTime }),
  totals: z.object({
    consents: z.number().int().nonnegative(),
    subjects: z.number().int().nonnegative(),
  }),
  /** One entry per UTC day, days without consents included as zero. */
  volume: z.array(z.object({ date: z.iso.date(), consents: z.number().int().nonnegative() })),
  /** Opt-in rate per purpose: granted / (granted + denied). */
  purposes: z.array(
    z.object({
      purpose: z.string(),
      granted: z.number().int().nonnegative(),
      denied: z.number().int().nonnegative(),
      optInRate: rate,
    }),
  ),
  jurisdictions: z.array(
    z.object({ jurisdiction: z.string(), consents: z.number().int().nonnegative() }),
  ),
});
export type StatsResponse = z.infer<typeof statsResponseSchema>;
