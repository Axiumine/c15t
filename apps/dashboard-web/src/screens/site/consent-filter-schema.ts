// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { consentListQuerySchema } from '@consent/shared';
import { z } from 'zod';

export interface ConsentSearch {
  readonly subject?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

function toQuery(value: {
  subject: string;
  from: string;
  to: string;
}): z.input<typeof consentListQuerySchema> {
  return {
    ...(value.subject.trim() === '' ? {} : { subject: value.subject.trim() }),
    ...(value.from === '' ? {} : { from: value.from }),
    ...(value.to === '' ? {} : { to: value.to }),
  };
}

/** The shared list-query schema decides what a valid filter is (range order, subject length). */
export const filterFormSchema = z
  .object({ subject: z.string(), from: z.string(), to: z.string() })
  .transform(toQuery)
  .pipe(consentListQuerySchema);

export type FilterValues = z.input<typeof filterFormSchema>;
