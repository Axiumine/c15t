// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { networkInterfaces } from 'node:os';

export function loopbackAddress(): string {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal && entry.family === 'IPv4') return entry.address;
    }
  }
  throw new Error('No IPv4 loopback interface found');
}

/** The next address in the loopback /8, so the proxy and the test client differ as TCP peers. */
export function neighbour(address: string): string {
  const parts = address.split('.').map(Number);
  const last = parts[3];
  if (last === undefined) throw new Error('Not an IPv4 address');
  parts[3] = last === 254 ? 253 : last + 1;
  return parts.join('.');
}
