// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { apiError, ERROR_STATUS, type ErrorCode } from '@consent/shared';

export function jsonError(
  code: ErrorCode,
  message: string,
  // eslint-disable-next-line security/detect-object-injection -- `code` is the closed ErrorCode union
  status = ERROR_STATUS[code],
): Response {
  return Response.json(apiError(code, message), { status });
}

export function unavailable(): Response {
  const response = jsonError(
    'SERVICE_UNAVAILABLE',
    'Consent storage is temporarily unavailable. Please retry.',
  );
  response.headers.set('Retry-After', '1');
  return response;
}
