// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { parseArgs } from 'node:util';
import { emailSchema } from '@consent/shared';
import { createAuth } from './auth.js';
import { AdminExistsError, createAdmin } from './bootstrap.js';
import { openDatabase } from './db.js';
import { EnvError, loadCliEnv } from './env.js';
import { silentLogger } from './logger.js';

/*
 * `yarn admin:create --email you@example.com [--name "Your Name"]`: bootstraps an administrator
 * and prints a one-time password. The password is shown once, on stdout, and nowhere else.
 */

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const { values } = parseArgs({
  options: { email: { type: 'string' }, name: { type: 'string' } },
  strict: true,
});
if (values.email === undefined)
  fail('Usage: yarn admin:create --email you@example.com [--name "Your Name"]');
const email = emailSchema.safeParse(values.email);
if (!email.success) fail('Invalid email address');

let env: ReturnType<typeof loadCliEnv>;
try {
  env = loadCliEnv();
} catch (error) {
  fail(error instanceof EnvError ? error.message : 'Could not read the environment');
}

// One short-lived connection to the primary: a CLI never needs a pool.
const db = openDatabase(
  { DATABASE_URL_DASHBOARD: env.DATABASE_URL_DASHBOARD, DATABASE_URL_DASHBOARD_REPLICA: undefined },
  'c15t-platform-admin-create',
);
const auth = createAuth({ db, env, logger: silentLogger });

let exitCode = 0;
try {
  const result = await createAdmin({ db, auth }, { email: email.data, name: values.name });
  process.stdout.write(
    [
      `Created administrator ${result.email}`,
      `One-time password (shown once, change it at the first login): ${result.oneTimePassword}`,
      '',
    ].join('\n'),
  );
} catch (error) {
  exitCode = 1;
  if (error instanceof AdminExistsError) process.stderr.write(`${error.message}\n`);
  else process.stderr.write('Could not create the administrator\n');
} finally {
  await db.close();
}
process.exit(exitCode);
