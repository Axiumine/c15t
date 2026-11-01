// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { SiteRow } from '@consent/db';
import type { Role } from '@consent/shared';

export interface SessionUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  readonly mustChangePassword: boolean;
}

const tenantScopeBrand: unique symbol = Symbol('tenantScope');

/**
 * The c15t `tenantId` values a request may read. Every query against `c15t.*` takes one, and
 * only `tenantScope` creates it: from the guards in authz.ts, never from request input.
 */
export interface TenantScope {
  readonly [tenantScopeBrand]: true;
  readonly tenantIds: readonly string[];
}

export function tenantScope(siteKeys: readonly string[]): TenantScope {
  return { [tenantScopeBrand]: true, tenantIds: [...siteKeys] };
}

export type AuthedEnv = { Variables: { user: SessionUser } };
export type SiteEnv = { Variables: { user: SessionUser; site: SiteRow; scope: TenantScope } };
