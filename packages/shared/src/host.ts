// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { z } from 'zod';
import { ipInCidrs } from './cidr.js';
import { parseIp } from './ip.js';

// The private ranges are the data this validator classifies bind addresses against.
// eslint-disable-next-line sonarjs/no-hardcoded-ip -- RFC 1918 and CGNAT ranges, not an endpoint
const PRIVATE_V4_RANGES = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10'];
const LOOPBACK_V4 = '127.0.0.0/8';
// eslint-disable-next-line sonarjs/no-hardcoded-ip -- the IPv6 unique-local range, not an endpoint
const PRIVATE_V6_ULA = 'fc00::/7';
const LOOPBACK_V6 = '::1/128';

export type HostClass = 'loopback' | 'private' | 'wildcard' | 'public' | 'invalid';

/** Classifies a bind address. `localhost` counts as loopback; other host names are invalid. */
export function classifyHost(input: string): HostClass {
  if (input.toLowerCase() === 'localhost') return 'loopback';
  const ip = parseIp(input);
  if (ip === null) return 'invalid';
  if (ip.value === 0n) return 'wildcard';
  if (ip.version === 4) {
    if (ipInCidrs(input, [LOOPBACK_V4])) return 'loopback';
    return ipInCidrs(input, PRIVATE_V4_RANGES) ? 'private' : 'public';
  }
  if (ipInCidrs(input, [LOOPBACK_V6])) return 'loopback';
  return ipInCidrs(input, [PRIVATE_V6_ULA]) ? 'private' : 'public';
}

const HOST_MESSAGES: Record<Exclude<HostClass, 'loopback' | 'private'>, string> = {
  wildcard: 'Wildcard addresses (0.0.0.0, ::) are not allowed. Bind a loopback or private address.',
  public: 'Public addresses are not allowed. Use loopback, RFC 1918, 100.64.0.0/10 or fc00::/7.',
  invalid: 'Must be an IPv4 or IPv6 literal (or localhost), without brackets or a zone id.',
};

/**
 * Bind address for consent-api and dashboard-api: loopback, RFC 1918, CGNAT `100.64.0.0/10`
 * or IPv6 ULA `fc00::/7`. Rejects `0.0.0.0`, `::` and public addresses.
 */
export const hostSchema = z
  .string()
  .trim()
  .superRefine((value, ctx) => {
    const kind = classifyHost(value);
    if (kind === 'loopback' || kind === 'private') return;
    // eslint-disable-next-line security/detect-object-injection -- `kind` is narrowed to the keys of HOST_MESSAGES
    ctx.addIssue({ code: 'custom', message: HOST_MESSAGES[kind] });
  });
