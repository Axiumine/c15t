// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { COUNTRY_HEADERS, GPC_HEADERS, REGION_HEADERS } from '@c15t/schema/geo';

/** The only geo headers a trusted proxy may forward: Cloudflare's own. */
const CLOUDFLARE_GEO_HEADERS = ['cf-ipcountry', 'cf-region-code'] as const;

/**
 * Headers a visitor could use to choose their own jurisdiction or GPC signal. c15t reads them
 * before Cloudflare's, and `sec-gpc` (the browser's own signal) stays. The lists come from the
 * installed c15t so an upgrade that reads a new header is covered without a code change; the
 * literals are a floor in case a future version renames the exports.
 */
export const VISITOR_OVERRIDE_HEADERS: readonly string[] = [
  ...new Set([
    ...COUNTRY_HEADERS,
    ...REGION_HEADERS,
    ...GPC_HEADERS.filter((name) => name !== 'sec-gpc'),
    'x-c15t-country',
    'x-c15t-region',
    'x-c15t-gpc',
    'x-vercel-ip-country',
    'x-vercel-ip-country-region',
    'x-amz-cf-ipcountry',
    'x-country-code',
    'x-country',
    'x-region-code',
  ]),
].filter((name) => !(CLOUDFLARE_GEO_HEADERS as readonly string[]).includes(name));

export const COUNTRY_CODE = /^(?:[A-Za-z]{2}|T1)$/;
export const REGION_CODE = /^[A-Za-z0-9-]{1,8}$/;
