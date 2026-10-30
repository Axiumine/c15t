// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { Hono } from 'hono';
import type { AppDatabase } from '../db.js';

const PING_TIMEOUT_MS = 2000;

async function pingWithin(ping: () => Promise<void>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), ms);
  });
  try {
    return await Promise.race([
      ping().then(
        () => true,
        () => false,
      ),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `GET /api/health`: no session. The process answering means it is alive. `db` says whether
 * the primary answered a ping, so monitoring can tell "up" from "up but cut off from Postgres".
 */
export function healthRoutes(deps: { db: Pick<AppDatabase, 'ping'> }) {
  return new Hono().get('/', async (c) => {
    const db = await pingWithin(deps.db.ping, PING_TIMEOUT_MS);
    return c.json({ status: db ? ('ok' as const) : ('degraded' as const), db });
  });
}
