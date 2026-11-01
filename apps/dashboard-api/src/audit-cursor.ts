// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { isRepresentableInstant } from '@consent/shared';
import { z } from 'zod';

/** A real instant in years 0001-9999: `2026-02-31` and year 0000 pass the zod shape check only. */
function isRealInstant(value: string): boolean {
  const ms = Date.parse(value);
  const day = value.slice(0, 10);
  return isRepresentableInstant(ms) && new Date(`${day}T00:00:00Z`).toISOString().startsWith(day);
}

export const auditCursorSchema = z.object({
  t: z.iso.datetime({ offset: true }).refine(isRealInstant, 'Not a timestamp'),
  i: z.uuid(),
});
