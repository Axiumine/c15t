// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

/**
 * The dashboard's API layer. The modules live in `./api/`; this file is the one import path for
 * the screens: errors and their texts, the typed client, the query client and the hooks.
 */

export { useAdminSites, useAuditLog } from './api/admin-reads';
export { consentsCsvHref, useConsents } from './api/consents';
export { ApiError } from './api/errors';
export { queryKeys } from './api/keys';
export { errorMessage, fieldIssues, isUnavailable } from './api/messages';
export { createQueryClient } from './api/query-client';
export {
  meQueryOptions,
  sitesQueryOptions,
  statsQueryOptions,
  useMe,
  useSite,
  useSiteStats,
  useSites,
} from './api/site-reads';
export { useCreateSite, useUpdateSite } from './api/site-writes';
