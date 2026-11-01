// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { z } from 'zod';
import { isoDateTime } from './iso-datetime.js';

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
