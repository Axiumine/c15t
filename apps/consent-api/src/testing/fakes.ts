// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { C15TInstance } from '@c15t/backend';
import type { Logger } from '../log.js';
import type { SiteRecord, SiteStore } from '../site-store.js';

export function siteRecord(key: string, overrides: Partial<SiteRecord> = {}): SiteRecord {
  return {
    key,
    domains: [`${key}.example.com`],
    policyPreset: 'eu-opt-in',
    status: 'active',
    ...overrides,
  };
}

export interface FakeInstance {
  readonly requests: Request[];
  disposed: number;
  handler: C15TInstance['handler'];
  dispose: C15TInstance['dispose'];
}

export function fakeInstance(
  respond: (request: Request) => Response | Promise<Response> = () => Response.json({ ok: true }),
): FakeInstance {
  const instance: FakeInstance = {
    requests: [],
    disposed: 0,
    handler: async (request) => {
      instance.requests.push(request);
      return respond(request);
    },
    dispose: async () => {
      instance.disposed += 1;
    },
  };
  return instance;
}

export class MemoryStore implements SiteStore {
  readonly sites = new Map<string, SiteRecord>();
  finds = 0;
  /** When set, `find` and `check` reject with it. */
  failure: Error | undefined;
  /** Runs inside `find`, before it answers. */
  onFind: (() => Promise<void>) | undefined;

  constructor(...records: SiteRecord[]) {
    for (const record of records) this.sites.set(record.key, record);
  }

  async find(key: string): Promise<SiteRecord | null> {
    this.finds += 1;
    // The row is read before the hook runs, like a query whose answer is overtaken by a NOTIFY.
    const row = this.sites.get(key) ?? null;
    if (this.failure !== undefined) throw this.failure;
    await this.onFind?.();
    return row;
  }

  async check(): Promise<{ activeSites: number }> {
    if (this.failure !== undefined) throw this.failure;
    return { activeSites: [...this.sites.values()].filter((s) => s.status === 'active').length };
  }
}

export interface LogLine {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly fields: Readonly<Record<string, unknown>> | undefined;
}

export function capturingLogger(): Logger & { readonly lines: LogLine[] } {
  const lines: LogLine[] = [];
  const record =
    (level: LogLine['level']) =>
    (message: string, fields?: Readonly<Record<string, unknown>>): void => {
      lines.push({ level, message, fields });
    };
  return { lines, info: record('info'), warn: record('warn'), error: record('error') };
}

/** A promise whose outcome the test decides. */
export function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
