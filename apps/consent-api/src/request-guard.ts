// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { ipInCidrs } from '@consent/shared';
import {
  CLIENT_IP_HEADER,
  clientAddress,
  IP_HEADERS,
  isForwardingHeader,
} from './forwarding-headers.js';
import { COUNTRY_CODE, REGION_CODE, VISITOR_OVERRIDE_HEADERS } from './override-headers.js';

/*
 * Request hardening for the headers c15t trusts (docs/decisions.md D1, CLAUDE.md "Network configuration"
 * and "Multi-tenancy"). nginx sets the tenant, the visitor IP and the Host; Cloudflare sets the
 * country and region. Nothing a browser sends may stand in for any of them. The query parameters
 * are in `override-params.ts`, the path in `request-path.ts` and the Host in `request-host.ts`.
 */

export interface SanitizeOptions {
  /** TCP peer address from the socket. `undefined` means unknown, which counts as untrusted. */
  readonly peer: string | undefined;
  readonly trustedProxies: readonly string[];
}

export interface SanitizedHeaders {
  readonly headers: Headers;
  /** The peer is in `CONSENT_API_TRUSTED_PROXIES`. */
  readonly trusted: boolean;
}

function dropUnlessMatches(headers: Headers, name: string, pattern: RegExp): void {
  const value = headers.get(name);
  if (value !== null && !pattern.test(value)) headers.delete(name);
}

/** What a trusted peer (nginx) may keep: one client address, and Cloudflare codes that look right. */
function sanitizeTrustedHeaders(headers: Headers, trustedProxies: readonly string[]): void {
  const client = clientAddress(headers.get(CLIENT_IP_HEADER), trustedProxies);
  for (const name of IP_HEADERS) headers.delete(name);
  headers.delete('forwarded');
  if (client !== undefined) headers.set(CLIENT_IP_HEADER, client);

  dropUnlessMatches(headers, 'cf-ipcountry', COUNTRY_CODE);
  dropUnlessMatches(headers, 'cf-region-code', REGION_CODE);
}

/**
 * Returns a copy of the headers that is safe to hand to c15t.
 *
 * - Jurisdiction and GPC override headers are always removed, from every peer.
 * - From an untrusted peer, all forwarding headers (`X-Forwarded-*`, `CF-*`, `Forwarded` and the
 *   IP headers) are removed too.
 * - From a trusted peer, `X-Forwarded-For` is reduced to the single client address, and
 *   Cloudflare's country and region are kept if they look like codes.
 */
export function sanitizeHeaders(source: Headers, options: SanitizeOptions): SanitizedHeaders {
  const headers = new Headers(source);
  const trusted = options.peer !== undefined && ipInCidrs(options.peer, options.trustedProxies);

  for (const name of VISITOR_OVERRIDE_HEADERS) headers.delete(name);

  if (!trusted) {
    for (const name of [...headers.keys()]) {
      if (isForwardingHeader(name)) headers.delete(name);
    }
    return { headers, trusted };
  }

  sanitizeTrustedHeaders(headers, options.trustedProxies);
  return { headers, trusted };
}
