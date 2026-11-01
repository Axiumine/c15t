// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { EntryRetirer } from './registry-retirer.js';
import type { Entry } from './registry-types.js';

const MAX_MISSING_KEYS = 1_000;

/**
 * Counts the changes announced for each site (and for all of them), so a load that raced with a
 * change notification can tell that what it read may be stale.
 */
export class Epochs {
  private readonly perSite = new Map<string, number>();
  private global = 0;

  stamp(siteKey: string): string {
    return `${this.global}:${this.perSite.get(siteKey) ?? 0}`;
  }

  bump(siteKey: string): void {
    this.perSite.set(siteKey, (this.perSite.get(siteKey) ?? 0) + 1);
  }

  bumpAll(): void {
    this.global += 1;
  }
}

/** Unknown or disabled sites, remembered for a while so probing keys cannot hammer the database. */
export class MissingKeys {
  private readonly until = new Map<string, number>();

  isMissing(siteKey: string, now: number): boolean {
    return (this.until.get(siteKey) ?? 0) > now;
  }

  remember(siteKey: string, expiresAt: number): void {
    if (this.until.size >= MAX_MISSING_KEYS) this.until.clear();
    this.until.set(siteKey, expiresAt);
  }

  forget(siteKey: string): void {
    this.until.delete(siteKey);
  }

  clear(): void {
    this.until.clear();
  }
}

/** The live entries by site key. An entry that leaves the table is retired, never dropped cold. */
export class EntryTable {
  private readonly live = new Map<string, Entry>();
  private readonly retirer: EntryRetirer;

  constructor(retirer: EntryRetirer) {
    this.retirer = retirer;
  }

  get size(): number {
    return this.live.size;
  }

  get(siteKey: string): Entry | undefined {
    return this.live.get(siteKey);
  }

  remove(siteKey: string): void {
    const entry = this.live.get(siteKey);
    if (entry === undefined) return;
    this.live.delete(siteKey);
    this.retirer.retire(entry);
  }

  /** Puts `entry` in place of the current one, which is retired. */
  replace(siteKey: string, entry: Entry): void {
    const current = this.live.get(siteKey);
    this.live.set(siteKey, entry);
    if (current !== undefined) this.retirer.retire(current);
  }

  clear(): void {
    for (const entry of this.live.values()) this.retirer.retire(entry);
    this.live.clear();
  }
}
