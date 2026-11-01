// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import {
  AUDIT_ACTIONS,
  AUDIT_TARGET_TYPES,
  DEFAULT_POLICY_PRESET,
  POLICY_PRESETS,
  ROLES,
  SITE_KEY_PATTERN,
  SITE_STATUSES,
} from '@consent/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/*
 * The `app` schema is owned by the `dashboard` role (README D2). Column names are spelled out
 * in snake_case on purpose, so no Drizzle `casing` option has to be set consistently anywhere.
 * The TypeScript keys of the Better Auth tables must stay exactly as Better Auth names its
 * fields, because its Drizzle adapter looks them up by key. `schema.test.ts` guards that.
 */
export const appSchema = pgSchema('app');

const quoted = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* Better Auth: core tables, admin plugin fields, and the `mustChangePassword` additional field. */

export const user = appSchema.table(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    role: text('role').notNull().default('user'),
    banned: boolean('banned').notNull().default(false),
    banReason: text('ban_reason'),
    banExpires: timestamp('ban_expires', { withTimezone: true }),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
  },
  (t) => [
    check('user_role_check', sql`${t.role} in (${quoted(ROLES)})`),
    check('user_email_lower_check', sql`${t.email} = lower(${t.email})`),
  ],
);

export const session = appSchema.table(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    impersonatedBy: text('impersonated_by'),
  },
  (t) => [index('session_user_id_idx').on(t.userId)],
);

export const account = appSchema.table(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('account_user_id_idx').on(t.userId),
    uniqueIndex('account_provider_account_idx').on(t.providerId, t.accountId),
  ],
);

export const verification = appSchema.table(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

/** Used when Better Auth is configured with `rateLimit.storage: 'database'`. */
export const rateLimit = appSchema.table('rate_limit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});

/* Platform tables. */

/** The site key pattern as a quoted SQL string literal, for the CHECK constraint. */
const SITE_KEY_SQL_PATTERN = `'${SITE_KEY_PATTERN.source}'`;

export const site = appSchema.table(
  'site',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Immutable (trigger in migration 0001). It is the URL segment and the c15t `tenantId`. */
    key: text('key').notNull(),
    name: text('name').notNull(),
    domains: text('domains').array().notNull(),
    policyPreset: text('policy_preset').notNull().default(DEFAULT_POLICY_PRESET),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('site_key_unique').on(t.key),
    check('site_key_format_check', sql`${t.key} ~ ${sql.raw(SITE_KEY_SQL_PATTERN)}`),
    check(
      'site_domains_check',
      sql`cardinality(${t.domains}) >= 1 and position('*' in array_to_string(${t.domains}, ',')) = 0`,
    ),
    check('site_policy_preset_check', sql`${t.policyPreset} in (${quoted(POLICY_PRESETS)})`),
    check('site_status_check', sql`${t.status} in (${quoted(SITE_STATUSES)})`),
  ],
);

export const siteMember = appSchema.table(
  'site_member',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    siteId: uuid('site_id')
      .notNull()
      .references(() => site.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'site_member_pk', columns: [t.userId, t.siteId] }),
    index('site_member_site_id_idx').on(t.siteId),
  ],
);

/**
 * Append-only: triggers in migration 0001 reject UPDATE, DELETE and TRUNCATE. There is no
 * foreign key to `user` so that deleting a user never rewrites history. `actorEmail` is a
 * snapshot for the same reason.
 */
export const adminAudit = appSchema.table(
  'admin_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: text('actor_id'),
    actorEmail: text('actor_email'),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [
    index('admin_audit_created_at_idx').on(t.createdAt.desc(), t.id.desc()),
    check('admin_audit_action_check', sql`${t.action} in (${quoted(AUDIT_ACTIONS)})`),
    check('admin_audit_target_type_check', sql`${t.targetType} in (${quoted(AUDIT_TARGET_TYPES)})`),
  ],
);

/** Pass to `drizzleAdapter(db, { provider: 'pg', schema: authSchema })` in Better Auth. */
export const authSchema = { user, session, account, verification, rateLimit } as const;

export type UserRow = typeof user.$inferSelect;
export type NewUserRow = typeof user.$inferInsert;
export type SessionRow = typeof session.$inferSelect;
export type SiteRow = typeof site.$inferSelect;
export type NewSiteRow = typeof site.$inferInsert;
export type SiteMemberRow = typeof siteMember.$inferSelect;
export type AdminAuditRow = typeof adminAudit.$inferSelect;
export type NewAdminAuditRow = typeof adminAudit.$inferInsert;
