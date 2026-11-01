// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { parseIpv4Value } from './ip-v4.js';

/*
 * Browser-safe IPv6 literal parsing (no `node:net`), because @consent/shared is also bundled by
 * dashboard-web. Part of the bind-address rules in README D1 and CLAUDE.md "Network configuration".
 */

export const IPV6_BITS = 128;

const IPV6_GROUP = /^[0-9a-f]{1,4}$/i;

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

export function parseIpv6Value(input: string): bigint | null {
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
