// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { z } from 'zod';
import { isoDateTime } from './iso-datetime.js';
import { pageSchema } from './pagination.js';

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
