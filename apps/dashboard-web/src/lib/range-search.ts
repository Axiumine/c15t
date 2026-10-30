// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { z } from 'zod';

/** URL state of a date-range filter. Bad values fall back to the default instead of erroring. */
export const rangeSearchSchema = z.object({
  range: z.enum(['7d', '30d', '90d', 'custom']).optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
});
