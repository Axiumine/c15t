// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

/*
 * Browser-safe IPv4 literal parsing (no `node:net`), because @consent/shared is also bundled by
 * dashboard-web. Part of the bind-address rules in docs/decisions.md D1 and CLAUDE.md "Network configuration".
 */

export const IPV4_BITS = 32;

const IPV4_OCTET = /^(0|[1-9]\d{0,2})$/;

export function parseIpv4Value(input: string): bigint | null {
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
