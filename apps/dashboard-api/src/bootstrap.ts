// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { user } from '@consent/db';
import { emailSchema } from '@consent/shared';
import { eq } from 'drizzle-orm';
import { writeAudit } from './audit.js';
import type { Auth } from './auth.js';
import type { AppDatabase } from './db.js';
import { generatePassword } from './password.js';

export class AdminExistsError extends Error {
  constructor(email: string) {
    super(`A user with the email ${email} already exists`);
    this.name = 'AdminExistsError';
  }
}

export interface BootstrapResult {
  readonly userId: string;
  readonly email: string;
  /** Returned to the caller exactly once. It is stored only as a hash. */
  readonly oneTimePassword: string;
}

/**
 * Creates an administrator straight through the Better Auth server API (`yarn admin:create`).
 * `mustChangePassword` is set, so the password must be changed at the first login. The row and
 * its audit entry share one transaction. Refuses when the email is taken.
 */
export async function createAdmin(
  deps: { db: Pick<AppDatabase, 'primary' | 'transaction'>; auth: Auth },
  input: { email: string; name?: string | undefined },
): Promise<BootstrapResult> {
  const email = emailSchema.parse(input.email);
  // `emailSchema` guarantees an `@`, so the part before it is the local part.
  const name = input.name?.trim() || email.slice(0, email.indexOf('@'));
  const password = generatePassword();
  const userId = await deps.db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, email))
      .limit(1);
    if (existing !== undefined) throw new AdminExistsError(email);
    const created = await deps.auth.api.createUser({
      body: { email, name, password, role: 'admin', data: { mustChangePassword: true } },
    });
    await writeAudit(tx, null, {
      action: 'user.create',
      targetType: 'user',
      targetId: created.user.id,
      metadata: { email, role: 'admin', source: 'cli' },
    });
    return created.user.id;
  });
  return { userId, email, oneTimePassword: password };
}
