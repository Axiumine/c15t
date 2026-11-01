// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { z } from 'zod';

export const POLICY_PRESETS = ['eu-opt-in', 'eu-us-opt-out', 'global-preferences'] as const;
export const policyPresetSchema = z.enum(POLICY_PRESETS);
export type PolicyPreset = z.infer<typeof policyPresetSchema>;
export const DEFAULT_POLICY_PRESET: PolicyPreset = 'eu-opt-in';

/**
 * Names of the `policyRulePresets` factories in @c15t/backend that make up each preset, in
 * match order. consent-api builds `manifest.policyRules` from this list. Starting points only:
 * which laws apply to a website is a legal decision (README open questions).
 */
export const POLICY_PRESET_RULES: Readonly<Record<PolicyPreset, readonly string[]>> = {
  'eu-opt-in': ['europeOptIn', 'worldNone'],
  'eu-us-opt-out': ['europeOptIn', 'quebecOptIn', 'usPrivacyStatesOptOut', 'worldNone'],
  'global-preferences': [
    'europeOptIn',
    'quebecOptIn',
    'usPrivacyStatesOptOut',
    'worldOptOutNoPrompt',
  ],
};

export const POLICY_PRESET_LABELS: Readonly<Record<PolicyPreset, string>> = {
  'eu-opt-in': 'EU, UK and unknown locations: opt-in. No banner elsewhere',
  'eu-us-opt-out': 'EU, UK and Quebec: opt-in. US states: opt-out. No banner elsewhere',
  'global-preferences': 'As above, but preferences stay reachable everywhere',
};
