// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Database } from '@consent/db';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { TenantScope } from './authz-types.js';
import type { ConsentCursor } from './consent-cursor.js';
import { type ConsentFilters, consentConditions } from './consent-filters.js';
import { consent, decision, domain, purpose, subject } from './consent-tables.js';

export async function purposeCodes(db: Database, scope: TenantScope): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: purpose.id, code: purpose.code })
    .from(purpose)
    .where(inArray(purpose.tenantId, [...scope.tenantIds]));
  return new Map(rows.map((row) => [row.id, row.code]));
}

interface FetchRowsOptions {
  readonly scope: TenantScope;
  readonly filters: ConsentFilters;
  readonly after: ConsentCursor | undefined;
  readonly limit: number;
}

export async function fetchRows(db: Database, { scope, filters, after, limit }: FetchRowsOptions) {
  return db
    .select({
      id: consent.id,
      subjectId: consent.subjectId,
      externalId: subject.externalId,
      domain: domain.name,
      givenAt: consent.givenAt,
      validUntil: consent.validUntil,
      purposeIds: consent.purposeIds,
      choice: consent.choice,
      consentAction: consent.consentAction,
      jurisdiction: consent.jurisdiction,
      jurisdictionModel: consent.jurisdictionModel,
      countryCode: decision.countryCode,
      regionCode: decision.regionCode,
      uiSource: consent.uiSource,
      ipAddress: consent.ipAddress,
      userAgent: consent.userAgent,
    })
    .from(consent)
    .innerJoin(
      subject,
      and(eq(subject.id, consent.subjectId), eq(subject.tenantId, consent.tenantId)),
    )
    .innerJoin(domain, and(eq(domain.id, consent.domainId), eq(domain.tenantId, consent.tenantId)))
    .leftJoin(
      decision,
      and(
        eq(decision.id, consent.runtimePolicyDecisionId),
        eq(decision.tenantId, consent.tenantId),
      ),
    )
    .where(consentConditions(scope, filters, after))
    .orderBy(desc(consent.givenAt), desc(consent.id))
    .limit(limit);
}

export type ConsentRow = Awaited<ReturnType<typeof fetchRows>>[number];
