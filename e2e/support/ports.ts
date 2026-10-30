// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { randomInt } from 'node:crypto';
import { createServer } from 'node:net';

/*
 * Free-port helper. Ports are picked below the Linux ephemeral range (32768+) so they cannot
 * collide with the source port of an outgoing connection, then proven free by binding them on
 * every interface: nginx in the test container listens on the wildcard address.
 */

const LOW = 20_000;
const HIGH = 32_000;

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
  for (let attempts = 0; picked.length < count; attempts++) {
    if (attempts > 500) throw new Error('Could not find free ports for the e2e stack');
    const port = randomInt(LOW, HIGH);
    if (picked.includes(port) || !(await canBind(port))) continue;
    picked.push(port);
  }
  return picked;
}
