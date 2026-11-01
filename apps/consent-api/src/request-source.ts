// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { HttpBindings } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { AppContext } from './app-types.js';

export function peerAddress(c: AppContext): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    // No socket behind the request (a test, or a future non-Node runtime): untrusted.
    return undefined;
  }
}

/** The request target as the client wrote it. `new URL` has already resolved `..` in `c.req.url`. */
export function requestTarget(c: AppContext): string {
  const incoming = (c.env as Partial<HttpBindings> | undefined)?.incoming;
  return incoming?.url ?? c.req.url;
}
