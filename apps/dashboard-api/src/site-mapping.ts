// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { SiteRow } from '@consent/db';
import {
  DEFAULT_BANNER_CATEGORIES,
  policyPresetSchema,
  type Site,
  type SiteDetail,
  type SiteSetup,
  siteStatusSchema,
} from '@consent/shared';

export function toSite(row: SiteRow): Site {
  return {
    key: row.key,
    name: row.name,
    domains: row.domains,
    policyPreset: policyPresetSchema.parse(row.policyPreset),
    status: siteStatusSchema.parse(row.status),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Copy-paste text for the Setup screen (docs/adding-a-website.md). The nginx lines are the
 * trusted tenant mapping. Values come from the site key only, and the server snippet names
 * environment variables instead of printing the API key or an address. The script tag declares
 * `data-categories`: without it c15t v3 records only `necessary` on "Accept All" for a page that
 * has no gated scripts (see DEFAULT_BANNER_CATEGORIES).
 */
export function siteSetup(siteKey: string): SiteSetup {
  return {
    nginx: `set $c15t_site ${siteKey};\ninclude snippets/c15t.conf;`,
    backendUrl: '/api/c15t',
    scriptTag: `<script src="/api/c15t/c15t.js" data-cfasync="false" data-categories="${DEFAULT_BANNER_CATEGORIES.join(',')}"></script>`,
    serverClient: [
      "import { createC15tClient } from '@c15t/node-sdk';",
      '',
      'const c15t = createC15tClient({',
      `  baseUrl: \`\${process.env.CONSENT_API_URL}/s/${siteKey}\`,`,
      '  apiKey: process.env.C15T_ADMIN_API_KEY,',
      '});',
    ].join('\n'),
  };
}

export function toSiteDetail(row: SiteRow): SiteDetail {
  return { ...toSite(row), setup: siteSetup(row.key) };
}
