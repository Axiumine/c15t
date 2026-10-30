// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { describe, expect, test } from 'vitest';
import {
  banUserSchema,
  changePasswordSchema,
  emailSchema,
  loginSchema,
  membershipSchema,
  meSchema,
  oneTimePasswordResultSchema,
  PASSWORD_MIN_LENGTH,
  roleSchema,
  userCreateSchema,
  userSitesSchema,
  userSummarySchema,
  userUpdateSchema,
} from './user.js';

describe('roleSchema', () => {
  test('only admin and user', () => {
    expect(roleSchema.parse('admin')).toBe('admin');
    expect(roleSchema.parse('user')).toBe('user');
    expect(roleSchema.safeParse('root').success).toBe(false);
    expect(roleSchema.safeParse('ADMIN').success).toBe(false);
  });
});

describe('emailSchema', () => {
  test('lowercases and trims', () => {
    expect(emailSchema.parse(' Jane@Example.COM ')).toBe('jane@example.com');
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });
});

describe('userCreateSchema', () => {
  test('defaults to a plain user with no sites', () => {
    expect(userCreateSchema.parse({ name: 'Jane', email: 'jane@example.com' })).toEqual({
      name: 'Jane',
      email: 'jane@example.com',
      role: 'user',
      siteKeys: [],
    });
  });

  test('never accepts a password from the caller', () => {
    const body = { name: 'Jane', email: 'jane@example.com', password: 'hunter2hunter2' };
    expect(userCreateSchema.safeParse(body).success).toBe(false);
  });

  test('validates site keys', () => {
    const base = { name: 'Jane', email: 'jane@example.com' };
    expect(userCreateSchema.safeParse({ ...base, siteKeys: ['shop', 'blog'] }).success).toBe(true);
    expect(userCreateSchema.safeParse({ ...base, siteKeys: ['shop', 'shop'] }).success).toBe(false);
    expect(userCreateSchema.safeParse({ ...base, siteKeys: ['X'] }).success).toBe(false);
  });
});

describe('userUpdateSchema and userSitesSchema', () => {
  test('update needs a field and rejects extras', () => {
    expect(userUpdateSchema.parse({ role: 'admin' })).toEqual({ role: 'admin' });
    expect(userUpdateSchema.safeParse({}).success).toBe(false);
    expect(userUpdateSchema.safeParse({ email: 'a@b.co' }).success).toBe(false);
  });

  test('sites body is the full set and may be empty', () => {
    expect(userSitesSchema.parse({ siteKeys: [] })).toEqual({ siteKeys: [] });
    expect(userSitesSchema.safeParse({ siteKeys: ['shop', 'shop'] }).success).toBe(false);
    expect(userSitesSchema.safeParse({}).success).toBe(false);
  });
});

describe('changePasswordSchema', () => {
  const good = { currentPassword: 'old-password-1', newPassword: 'a-much-longer-new-password' };

  test('accepts a different, long enough password', () => {
    expect(changePasswordSchema.parse(good).revokeOtherSessions).toBe(true);
  });

  test('rejects short, long and unchanged passwords', () => {
    expect(
      changePasswordSchema.safeParse({ ...good, newPassword: 'x'.repeat(PASSWORD_MIN_LENGTH - 1) })
        .success,
    ).toBe(false);
    expect(changePasswordSchema.safeParse({ ...good, newPassword: 'x'.repeat(129) }).success).toBe(
      false,
    );
    expect(
      changePasswordSchema.safeParse({ ...good, newPassword: `${good.currentPassword}abcd` })
        .success,
    ).toBe(true);
    const same = 'the-same-password-12';
    expect(
      changePasswordSchema.safeParse({ currentPassword: same, newPassword: same }).success,
    ).toBe(false);
  });
});

describe('loginSchema and banUserSchema', () => {
  test('login normalises the email', () => {
    expect(loginSchema.parse({ email: 'A@B.CO', password: 'x' })).toEqual({
      email: 'a@b.co',
      password: 'x',
    });
    expect(loginSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });

  test('ban takes an optional reason and positive duration', () => {
    expect(banUserSchema.parse({})).toEqual({});
    expect(banUserSchema.parse({ reason: ' abuse ', expiresInSeconds: 3600 })).toEqual({
      reason: 'abuse',
      expiresInSeconds: 3600,
    });
    expect(banUserSchema.safeParse({ expiresInSeconds: 0 }).success).toBe(false);
    expect(banUserSchema.safeParse({ expiresInSeconds: 1.5 }).success).toBe(false);
  });
});

describe('response shapes', () => {
  const me = {
    id: 'u1',
    name: 'Jane',
    email: 'jane@example.com',
    role: 'user',
    mustChangePassword: true,
  };
  const summary = {
    ...me,
    banned: false,
    banReason: null,
    banExpires: null,
    siteKeys: ['shop'],
    createdAt: '2026-10-30T12:00:00.000Z',
  };

  test('me, summary and membership', () => {
    expect(meSchema.safeParse(me).success).toBe(true);
    expect(userSummarySchema.safeParse(summary).success).toBe(true);
    expect(userSummarySchema.safeParse(me).success).toBe(false);
    expect(
      membershipSchema.safeParse({
        userId: 'u1',
        siteKey: 'shop',
        createdAt: '2026-10-30T12:00:00Z',
      }).success,
    ).toBe(true);
  });

  test('one-time password result enforces the minimum length', () => {
    expect(
      oneTimePasswordResultSchema.safeParse({ user: summary, oneTimePassword: 'x'.repeat(24) })
        .success,
    ).toBe(true);
    expect(
      oneTimePasswordResultSchema.safeParse({ user: summary, oneTimePassword: 'short' }).success,
    ).toBe(false);
  });
});
