// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

/** The c15t consent categories (`necessary` is always on). */
export const CONSENT_CATEGORIES = [
  'necessary',
  'functionality',
  'measurement',
  'experience',
  'marketing',
] as const;

/**
 * What the generated banner script tag declares in `data-categories`. c15t v3 offers only the
 * categories it can discover from the page's gated scripts, so a page without any records only
 * `necessary` on "Accept All" and the per-purpose opt-in rates stay empty. A site does not store
 * its categories, so the tag carries the common pair and the Setup screen tells the operator to
 * list the ones the site really uses.
 */
export const DEFAULT_BANNER_CATEGORIES = ['measurement', 'marketing'] as const;
