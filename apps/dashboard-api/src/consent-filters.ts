// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { and, eq, gte, inArray, lt, or, type SQL } from 'drizzle-orm';
import type { TenantScope } from './authz-types.js';
import type { ConsentCursor } from './consent-cursor.js';
import { consent, subject } from './consent-tables.js';
import { type TimeBounds, toNaiveUtc } from './range.js';

export interface ConsentFilters extends TimeBounds {
  readonly subject?: string | undefined;
}

export function inScope(scope: TenantScope): SQL {
  // An empty list renders as `false`, so an empty scope returns nothing.
  return inArray(consent.tenantId, [...scope.tenantIds]);
}

export function consentConditions(
  scope: TenantScope,
  filters: ConsentFilters,
  after: ConsentCursor | undefined,
): SQL | undefined {
  const conditions: (SQL | undefined)[] = [inScope(scope)];
  if (filters.subject !== undefined) {
    conditions.push(
      or(eq(consent.subjectId, filters.subject), eq(subject.externalId, filters.subject)),
    );
  }
  if (filters.from !== undefined) conditions.push(gte(consent.givenAt, toNaiveUtc(filters.from)));
  if (filters.to !== undefined) conditions.push(lt(consent.givenAt, toNaiveUtc(filters.to)));
  if (after !== undefined) {
    conditions.push(
      or(lt(consent.givenAt, after.g), and(eq(consent.givenAt, after.g), lt(consent.id, after.i))),
    );
  }
  return and(...conditions);
}
