// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { ConsentRecord } from '@consent/shared';
import { derivePurposes } from './consent-purposes.js';
import type { ConsentRow } from './consent-rows.js';
import { fromNaiveUtc } from './range.js';

export function toConsentRecord(
  row: ConsentRow,
  codesById: ReadonlyMap<string, string>,
): ConsentRecord {
  return {
    id: row.id,
    subjectId: row.subjectId,
    externalId: row.externalId,
    domain: row.domain,
    givenAt: fromNaiveUtc(row.givenAt),
    validUntil: row.validUntil === null ? null : fromNaiveUtc(row.validUntil),
    purposes: derivePurposes(row.choice, row.purposeIds, codesById),
    consentAction: row.consentAction,
    jurisdiction: row.jurisdiction,
    jurisdictionModel: row.jurisdictionModel,
    countryCode: row.countryCode,
    regionCode: row.regionCode,
    uiSource: row.uiSource,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
  };
}
