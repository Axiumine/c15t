// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

/** A site row that cannot be turned into a safe c15t instance. Never cached, never served. */
export class SiteConfigError extends Error {
  readonly siteKey: string;

  constructor(siteKey: string, message: string) {
    super(message);
    this.name = 'SiteConfigError';
    this.siteKey = siteKey;
  }
}
