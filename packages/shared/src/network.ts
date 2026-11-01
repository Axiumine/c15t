// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { z } from 'zod';

/*
 * Browser-safe IP helpers (no `node:net`), because @consent/shared is also bundled by
 * dashboard-web. They back the bind-address rules in README D1 and CLAUDE.md "Network
 * configuration": loopback or private LAN only, never a wildcard or a public address.
 */

export type ParsedIp = { readonly version: 4 | 6; readonly value: bigint };
export type ParsedCidr = ParsedIp & { readonly prefix: number };

const IPV4_OCTET = /^(0|[1-9]\d{0,2})$/;
const IPV6_GROUP = /^[0-9a-f]{1,4}$/i;
const IPV4_MAPPED_PREFIX = 0xffffn << 32n;
const IPV4_BITS = 32;
const IPV6_BITS = 128;

function parseIpv4Value(input: string): bigint | null {
  const parts = input.split('.');
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    // Leading zeros are rejected: inet_aton reads "010" as octal, other parsers as decimal.
    if (!IPV4_OCTET.test(part) || Number(part) > 255) return null;
    value = (value << 8n) | BigInt(part);
  }
  return value;
}

function parseGroups(text: string): number[] | null {
  if (text === '') return [];
  const groups: number[] = [];
  for (const group of text.split(':')) {
    if (!IPV6_GROUP.test(group)) return null;
    groups.push(Number.parseInt(group, 16));
  }
  return groups;
}

/** Rewrites a trailing dotted quad (`::ffff:1.2.3.4`) as two hex groups. */
function expandEmbeddedIpv4(text: string): string | null {
  if (!text.includes('.')) return text;
  const lastColon = text.lastIndexOf(':');
  const embedded = parseIpv4Value(text.slice(lastColon + 1));
  if (embedded === null) return null;
  const high = (embedded >> 16n).toString(16);
  const low = (embedded & 0xffffn).toString(16);
  return `${text.slice(0, lastColon + 1)}${high}:${low}`;
}

/** The eight groups of an address; a "::" at index `gap` stands in for the missing zero groups. */
function expandGroups(text: string, gap: number): number[] | null {
  const head = parseGroups(gap === -1 ? text : text.slice(0, gap));
  if (head === null) return null;
  if (gap === -1) return head.length === 8 ? head : null;
  const tail = parseGroups(text.slice(gap + 2));
  if (tail === null || head.length + tail.length > 7) return null;
  return [...head, ...new Array<number>(8 - head.length - tail.length).fill(0), ...tail];
}

function parseIpv6Value(input: string): bigint | null {
  if (!input.includes(':') || input.includes('%')) return null;
  const text = expandEmbeddedIpv4(input);
  if (text === null) return null;
  // At most one "::" may stand in for a run of zero groups.
  const gap = text.indexOf('::');
  if (gap !== -1 && text.slice(gap + 2).includes('::')) return null;
  const groups = expandGroups(text, gap);
  if (groups === null) return null;
  return groups.reduce((acc, group) => (acc << 16n) | BigInt(group), 0n);
}

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

/** TCP port from 1024 to 65535. Accepts a number or a decimal string (env values are strings). */
export const portSchema = z
  .union([
    z.number(),
    z
      .string()
      .trim()
      .regex(/^\d{1,5}$/, 'Port must be a decimal integer'),
  ])
  .transform((value) => Number(value))
  .pipe(z.number().int().min(1024, 'Port must be 1024 or higher').max(65535));

/** One IPv4 or IPv6 CIDR such as `127.0.0.1/32` or `::1/128`. */
export const cidrSchema = z
  .string()
  .trim()
  .refine((value) => parseCidr(value) !== null, 'Must be a CIDR such as 10.0.0.0/8 or fd00::/8');

/** Comma-separated CIDR list (for `CONSENT_API_TRUSTED_PROXIES`) parsed into an array. */
export const cidrListSchema = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== ''),
  )
  .pipe(z.array(cidrSchema).min(1, 'At least one CIDR is required'));

/** Web origin without a path, e.g. `https://dashboard.example.com`. Used for BETTER_AUTH_URL. */
export const originSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const message = 'Must be an http(s) origin without path, query or credentials';
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: 'custom', message });
      return z.NEVER;
    }
    const plain =
      url.pathname === '/' && url.search === '' && url.hash === '' && url.username === '';
    if (!['http:', 'https:'].includes(url.protocol) || !plain) {
      ctx.addIssue({ code: 'custom', message });
      return z.NEVER;
    }
    return url.origin;
  });
