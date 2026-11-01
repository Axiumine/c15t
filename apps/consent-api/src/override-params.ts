// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

/**
 * `/init` reads these query parameters before the headers above, and documents them as
 * visitor-controlled (c15t "HTTP endpoints, query parameters and CORS").
 */
export const VISITOR_OVERRIDE_PARAMS: readonly string[] = ['country', 'region', 'gpc'];

/** The request URL without the query parameters that let a visitor choose their jurisdiction. */
export function stripOverrideParams(url: string): string {
  const parsed = new URL(url);
  if (!VISITOR_OVERRIDE_PARAMS.some((name) => parsed.searchParams.has(name))) return url;
  for (const name of VISITOR_OVERRIDE_PARAMS) parsed.searchParams.delete(name);
  return parsed.toString();
}
