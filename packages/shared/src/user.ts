// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { z } from 'zod';
import { siteKeySchema } from './site.js';
import { noNul } from './text.js';

export const ROLES = ['admin', 'user'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

const userNameSchema = noNul(z.string().trim().min(1).max(120));
const isoDateTime = z.iso.datetime({ offset: true });
const uniqueSiteKeys = z
  .array(siteKeySchema)
  .max(500)
  .refine((keys) => new Set(keys).size === keys.length, 'Site keys must be unique');

/** The password is generated server-side and returned once, so it is not an input. */
export const userCreateSchema = z.strictObject({
  name: userNameSchema,
  email: emailSchema,
  role: roleSchema.default('user'),
  siteKeys: uniqueSiteKeys.default([]),
});
export type UserCreateInput = z.input<typeof userCreateSchema>;
export type UserCreate = z.output<typeof userCreateSchema>;

export const userUpdateSchema = z
  .strictObject({
    name: userNameSchema.optional(),
    role: roleSchema.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to change',
  });
export type UserUpdate = z.infer<typeof userUpdateSchema>;

/** Body of `PUT /api/admin/users/:id/sites`: the complete new set of assigned sites. */
export const userSitesSchema = z.strictObject({ siteKeys: uniqueSiteKeys });
export type UserSites = z.infer<typeof userSitesSchema>;

export const membershipSchema = z.object({
  userId: z.string().min(1),
  siteKey: siteKeySchema,
  createdAt: isoDateTime,
});
export type Membership = z.infer<typeof membershipSchema>;

export const banUserSchema = z.strictObject({
  reason: noNul(z.string().trim().min(1).max(500)).optional(),
  expiresInSeconds: z.number().int().positive().max(31_536_000).optional(),
});
export type BanUserInput = z.infer<typeof banUserSchema>;

export const changePasswordSchema = z
  .strictObject({
    currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    newPassword: passwordSchema,
    revokeOtherSessions: z.boolean().default(true),
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ['newPassword'],
    message: 'The new password must differ from the current one',
  });
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;

export const loginSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginInput = z.input<typeof loginSchema>;

/** `GET /api/me` */
export const meSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  email: z.string(),
  role: roleSchema,
  mustChangePassword: z.boolean(),
});
export type Me = z.infer<typeof meSchema>;

/** Row of the admin user list. */
export const userSummarySchema = meSchema.extend({
  banned: z.boolean(),
  banReason: z.string().nullable(),
  banExpires: isoDateTime.nullable(),
  siteKeys: z.array(siteKeySchema),
  createdAt: isoDateTime,
});
export type UserSummary = z.infer<typeof userSummarySchema>;

/** Response of `POST /api/admin/users` and `.../reset-password`: the only time the password is visible. */
export const oneTimePasswordResultSchema = z.object({
  user: userSummarySchema,
  oneTimePassword: z.string().min(PASSWORD_MIN_LENGTH),
});
export type OneTimePasswordResult = z.infer<typeof oneTimePasswordResultSchema>;
