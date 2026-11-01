// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { request } from 'node:http';
import type { Runtime } from './runtime.js';

/** `fetch` cannot set `Host`; the vhost is chosen by it, so this uses `node:http`. */
function statusOf(rt: Runtime, host: string, path: string): Promise<number> {
  return new Promise((resolveStatus, reject) => {
    const req = request(
      {
        host: rt.loopback,
        port: rt.ports.nginx,
        path,
        headers: { host: `${host}:${rt.ports.nginx}` },
      },
      (response) => {
        response.resume();
        resolveStatus(response.statusCode ?? 0);
      },
    );
    req.setTimeout(2_000, () => req.destroy(new Error('timeout')));
    req.once('error', reject);
    req.end();
  });
}

export async function waitUntilServing(rt: Runtime, host: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  let last = 'no response';
  while (Date.now() < deadline) {
    try {
      const status = await statusOf(rt, host, '/index.html');
      if (status === 200) return;
      last = `HTTP ${status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error(`nginx test container did not serve ${host} in time (${last})`);
}
