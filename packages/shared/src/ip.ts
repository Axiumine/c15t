// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { IPV4_BITS, parseIpv4Value } from './ip-v4.js';
import { IPV6_BITS, parseIpv6Value } from './ip-v6.js';

/*
 * Browser-safe IP helpers (no `node:net`), because @consent/shared is also bundled by
 * dashboard-web. They back the bind-address rules in README D1 and CLAUDE.md "Network
 * configuration": loopback or private LAN only, never a wildcard or a public address.
 */

export type ParsedIp = { readonly version: 4 | 6; readonly value: bigint };
export type ParsedCidr = ParsedIp & { readonly prefix: number };

/** Parses an IPv4 or IPv6 literal. IPv4-mapped IPv6 (`::ffff:a.b.c.d`) is returned as IPv4. */
export function parseIp(input: string): ParsedIp | null {
  const v4 = parseIpv4Value(input);
  if (v4 !== null) return { version: 4, value: v4 };
  const v6 = parseIpv6Value(input);
  if (v6 === null) return null;
  if (v6 >> 32n === 0xffffn) return { version: 4, value: v6 & 0xffff_ffffn };
  return { version: 6, value: v6 };
}

/** Parses `address/prefix`. The address is not normalised, so `::ffff:1.2.3.4/96` stays IPv6. */
export function parseCidr(input: string): ParsedCidr | null {
  const slash = input.indexOf('/');
  if (slash === -1) return null;
  const address = input.slice(0, slash);
  const prefixText = input.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefixText)) return null;
  const prefix = Number(prefixText);
  const v4 = parseIpv4Value(address);
  if (v4 !== null) return prefix <= IPV4_BITS ? { version: 4, value: v4, prefix } : null;
  const v6 = parseIpv6Value(address);
  if (v6 === null || prefix > IPV6_BITS) return null;
  return { version: 6, value: v6, prefix };
}
