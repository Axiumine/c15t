// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { z } from 'zod';

const FAILURE_BODY = z.object({ cause: z.object({ code: z.string() }) });
/** c15t answers a failed query with 500 DATABASE_ERROR, and `/status` with 503 SERVICE_UNAVAILABLE. */
const DATABASE_FAILURE_CODES: ReadonlySet<string> = new Set([
  'DATABASE_ERROR',
  'SERVICE_UNAVAILABLE',
]);

export async function isDatabaseFailure(response: Response): Promise<boolean> {
  if (response.status !== 500 && response.status !== 503) return false;
  try {
    const parsed = FAILURE_BODY.safeParse(await response.clone().json());
    return parsed.success && DATABASE_FAILURE_CODES.has(parsed.data.cause.code);
  } catch {
    return false;
  }
}
