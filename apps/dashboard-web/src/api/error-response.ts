// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { apiErrorSchema } from '@consent/shared';
import { ApiError } from './errors';

export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = apiErrorSchema.safeParse(body);
  if (!parsed.success) return new ApiError({ status: response.status });
  const { code, message, issues } = parsed.data.error;
  return new ApiError({ status: response.status, code, message, issues });
}
