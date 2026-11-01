// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { type ParsedCidr, type ParsedIp, parseCidr, parseIp } from './ip.js';
import { IPV4_BITS } from './ip-v4.js';
import { IPV6_BITS } from './ip-v6.js';

const IPV4_MAPPED_PREFIX = 0xffffn << 32n;

function prefixMask(version: 4 | 6, prefix: number): bigint {
  const bits = version === 4 ? IPV4_BITS : IPV6_BITS;
  return ((1n << BigInt(bits)) - 1n) ^ ((1n << BigInt(bits - prefix)) - 1n);
}

function cidrContains(cidr: ParsedCidr, ip: ParsedIp): boolean {
  if (cidr.version !== ip.version) {
    // An IPv4-mapped CIDR (::ffff:0:0/96 and longer) must still match a mapped peer address.
    if (cidr.version === 6 && ip.version === 4 && cidr.prefix >= 96) {
      const mapped = IPV4_MAPPED_PREFIX | ip.value;
      const mask = prefixMask(6, cidr.prefix);
      return (mapped & mask) === (cidr.value & mask);
    }
    return false;
  }
  const mask = prefixMask(ip.version, cidr.prefix);
  return (ip.value & mask) === (cidr.value & mask);
}

/**
 * True when `ip` falls inside any CIDR. Malformed input never matches, so a bad peer address
 * can never be treated as trusted.
 */
export function ipInCidrs(ip: string, cidrs: readonly string[]): boolean {
  const parsed = parseIp(ip);
  if (parsed === null) return false;
  return cidrs.some((cidr) => {
    const parsedCidr = parseCidr(cidr);
    return parsedCidr !== null && cidrContains(parsedCidr, parsed);
  });
}
