// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { DEFAULT_IP_HEADERS_LIST } from '@c15t/schema/geo';
import { ipInCidrs, parseIp } from '@consent/shared';

export const CLIENT_IP_HEADER = 'x-forwarded-for';

/** Every header a proxy may use to carry the client IP. c15t is told to read only `x-forwarded-for`. */
export const IP_HEADERS: ReadonlySet<string> = new Set([
  ...DEFAULT_IP_HEADERS_LIST,
  'true-client-ip',
  'x-real-ip',
  'x-client-ip',
  'cf-connecting-ip',
  'cf-connecting-ipv6',
]);

export function isForwardingHeader(name: string): boolean {
  return (
    name.startsWith('x-forwarded-') ||
    name.startsWith('cf-') ||
    name === 'forwarded' ||
    IP_HEADERS.has(name)
  );
}

/**
 * The client address in an `X-Forwarded-For` chain: the first entry, read right to left, that is
 * not one of our own proxies. A visitor can prepend entries; they cannot change what the proxies
 * append. A malformed entry yields no address at all, rather than a guess.
 */
export function clientAddress(
  forwardedFor: string | null,
  trustedProxies: readonly string[],
): string | undefined {
  if (forwardedFor === null) return undefined;
  const entries = forwardedFor
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries.at(index);
    if (entry === undefined || parseIp(entry) === null) return undefined;
    if (index === 0 || !ipInCidrs(entry, trustedProxies)) return entry;
  }
  return undefined;
}
