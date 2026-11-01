// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { DateRange } from '../lib/range';

export interface ConsentFilters {
  readonly subject?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export const queryKeys = {
  me: ['me'] as const,
  sites: ['sites'] as const,
  site: (siteKey: string) => ['sites', siteKey] as const,
  stats: (siteKey: string, range: DateRange) => ['sites', siteKey, 'stats', range] as const,
  consents: (siteKey: string, filters: ConsentFilters) =>
    ['sites', siteKey, 'consents', filters] as const,
  adminSites: ['admin', 'sites'] as const,
  adminUsers: ['admin', 'users'] as const,
  adminAudit: ['admin', 'audit'] as const,
};
