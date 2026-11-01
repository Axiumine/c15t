// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { ROLES, type Role } from '@consent/shared';
import type { Auth } from './auth.js';
import type { SessionUser } from './authz-types.js';
import { HttpError } from './errors.js';

/** What the guards need from a request context, so one signature fits every route group's env. */
export interface SessionSlot {
  get(key: 'user'): SessionUser | undefined;
  set(key: 'user', value: SessionUser): void;
  readonly req: { readonly raw: Request };
}

const isRole = (value: unknown): value is Role => ROLES.some((role) => role === value);

export interface SessionDeps {
  readonly auth: Auth;
  readonly now: () => Date;
}

async function readSession({ auth, now }: SessionDeps, c: SessionSlot): Promise<SessionUser> {
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  if (result === null) throw new HttpError('UNAUTHORIZED', 'Authentication is required');
  const { user } = result;
  const banActive =
    user.banned === true && (user.banExpires == null || new Date(user.banExpires) > now());
  if (banActive) throw new HttpError('UNAUTHORIZED', 'This account is disabled');
  // Fail closed: an unknown role string gets no access at all.
  if (!isRole(user.role)) throw new HttpError('FORBIDDEN', 'You are not allowed to do this');
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    mustChangePassword: user.mustChangePassword === true,
  };
}

export async function loadUser(
  deps: SessionDeps,
  c: SessionSlot,
  allowPasswordChange: boolean,
): Promise<SessionUser> {
  const cached: SessionUser | undefined = c.get('user');
  const user = cached ?? (await readSession(deps, c));
  if (user.mustChangePassword && !allowPasswordChange) {
    throw new HttpError(
      'PASSWORD_CHANGE_REQUIRED',
      'You must change your password before continuing',
    );
  }
  c.set('user', user);
  return user;
}
