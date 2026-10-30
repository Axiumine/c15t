// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { createApp } from './app.js';
import { createAuth } from './auth.js';
import { type AppDatabase, openDatabase } from './db.js';
import type { Env } from './env.js';
import type { Logger } from './logger.js';

export interface Services {
  readonly app: ReturnType<typeof createApp>;
  readonly db: AppDatabase;
}

/** Wires pools, Better Auth and the route tree. Opens no connection until the first query. */
export function compose(env: Env, logger: Logger): Services {
  const db = openDatabase(env);
  const auth = createAuth({ db, env, logger });
  return { app: createApp({ env, db, auth, logger }), db };
}
