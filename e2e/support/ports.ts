// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { randomInt } from 'node:crypto';
import { createServer } from 'node:net';

/*
 * Free-port helper. Ports are picked at random above 50000 (50001 to 65535) and proven free by
 * binding them on every interface: nginx in the test container listens on the wildcard address.
 * Part of that range is also the Linux ephemeral range (up to 60999), so a port can still be taken
 * by an outgoing connection between the probe and the server start; the bind probe makes that rare.
 */

const LOW = 50_001;
const HIGH = 65_536; // exclusive

function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, () => probe.close(() => resolve(true)));
  });
}

/** Distinct free ports, in the order requested. */
export async function freePorts(count: number): Promise<number[]> {
  const picked: number[] = [];
  for (let attempts = 0; attempts <= 500 && picked.length < count; attempts++) {
    const port = randomInt(LOW, HIGH);
    if (picked.includes(port) || !(await canBind(port))) continue;
    picked.push(port);
  }
  if (picked.length < count) throw new Error('Could not find free ports for the e2e stack');
  return picked;
}
