// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

/*
 * Read-only queries over the `c15t` schema (README D4). Rules, in order of importance:
 * 1. Every query filters by `tenantId IN scope.tenantIds`. A `TenantScope` can only come from
 *    authz.ts, never from request input.
 * 2. Related rows (subject, domain, policy decision) are joined on the same tenant.
 * 3. Nothing here writes. The role behind `db.analytics` has SELECT only.
 *
 * The queries are in consent-*.ts: filters and rows (consent-filters, consent-rows), the list and
 * export batches (consent-list), the CSV export (consent-csv) and the statistics (consent-stats).
 * This module is the entry point that the routes import.
 */

export { CSV_HEADER, consentCsvRow, consentCsvStream } from './consent-csv.js';
export { consentBatches, listConsents } from './consent-list.js';
export { consentStats } from './consent-stats.js';
