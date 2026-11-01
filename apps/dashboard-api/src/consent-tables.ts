// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { c15t } from '@consent/db';

/** The `c15t` tables that the consent queries read, under the names the queries use. */
export const {
  consentInC15T: consent,
  subjectInC15T: subject,
  domainInC15T: domain,
  runtimePolicyDecisionInC15T: decision,
  consentPurposeInC15T: purpose,
} = c15t;
