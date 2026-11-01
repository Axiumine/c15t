// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { z } from 'zod';
import { isoDateTime } from './iso-datetime.js';
import { pageQuerySchema } from './pagination.js';
import { isRepresentableInstant, noNul } from './text.js';

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
