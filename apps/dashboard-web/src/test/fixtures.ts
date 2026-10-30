// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type {
  AuditEntry,
  ConsentRecord,
  Me,
  Site,
  SiteDetail,
  StatsResponse,
  UserSummary,
} from '@consent/shared';

const STAMP = '2026-03-05T12:00:00.000Z';

export const admin: Me = {
  id: 'u-admin',
  name: 'Ada Admin',
  email: 'ada@example.com',
  role: 'admin',
  mustChangePassword: false,
};

export const plainUser: Me = {
  id: 'u-user',
  name: 'Una User',
  email: 'una@example.com',
  role: 'user',
  mustChangePassword: false,
};

export const shop: Site = {
  key: 'shop',
  name: 'Shop',
  domains: ['shop.example.com', 'www.shop.example.com'],
  policyPreset: 'eu-opt-in',
  status: 'active',
  createdAt: STAMP,
  updatedAt: STAMP,
};

export const blog: Site = { ...shop, key: 'blog', name: 'Blog', domains: ['blog.example.com'] };

export const shopDetail: SiteDetail = {
  ...shop,
  setup: {
    nginx: 'set $c15t_site shop;\ninclude snippets/c15t.conf;',
    backendUrl: '/api/c15t',
    scriptTag:
      '<script src="/api/c15t/c15t.js" data-cfasync="false" data-categories="measurement,marketing"></script>',
    serverClient: "const c15t = createC15tClient({ baseUrl: '/s/shop' });",
  },
};

export const stats: StatsResponse = {
  range: { from: '2026-02-04T00:00:00.000Z', to: '2026-03-06T00:00:00.000Z' },
  totals: { consents: 1280, subjects: 640 },
  volume: [
    { date: '2026-03-03', consents: 400 },
    { date: '2026-03-04', consents: 0 },
    { date: '2026-03-05', consents: 880 },
  ],
  purposes: [
    { purpose: 'measurement', granted: 900, denied: 380, optInRate: 0.703 },
    { purpose: 'marketing', granted: 300, denied: 980, optInRate: 0.234 },
  ],
  jurisdictions: [
    { jurisdiction: 'GDPR', consents: 1000 },
    { jurisdiction: 'CCPA', consents: 280 },
  ],
};

export function consent(id: string, overrides: Partial<ConsentRecord> = {}): ConsentRecord {
  return {
    id,
    subjectId: `sub_${id}`,
    externalId: null,
    domain: 'shop.example.com',
    givenAt: STAMP,
    validUntil: null,
    purposes: { measurement: true, marketing: false },
    consentAction: 'accept_custom',
    jurisdiction: 'GDPR',
    jurisdictionModel: 'opt-in',
    countryCode: 'IT',
    regionCode: null,
    uiSource: 'banner',
    ipAddress: null,
    userAgent: 'Mozilla/5.0',
    ...overrides,
  };
}

export function userSummary(overrides: Partial<UserSummary> = {}): UserSummary {
  return {
    ...plainUser,
    banned: false,
    banReason: null,
    banExpires: null,
    siteKeys: ['shop'],
    createdAt: STAMP,
    ...overrides,
  };
}

export const auditEntry: AuditEntry = {
  id: 'a1',
  actorId: 'u-admin',
  actorEmail: 'ada@example.com',
  action: 'site.create',
  targetType: 'site',
  targetId: 'shop',
  metadata: { name: 'Shop' },
  ip: '203.0.113.7',
  createdAt: STAMP,
};
