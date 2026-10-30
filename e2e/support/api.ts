// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { randomBytes, randomInt } from 'node:crypto';
import { type APIRequestContext, type APIResponse, expect, request } from '@playwright/test';
import type { Credentials } from './bootstrap.js';
import { recordClientIp } from './db.js';
import type { Runtime } from './runtime.js';

/** A random visitor address (198.18.0.0/15, the benchmarking range), one per browser or client. */
export function randomClientIp(rt: Runtime): string {
  // randomInt is uniform; `byte % n` on a random byte is not when n does not divide 256.
  const ip = `198.${randomInt(18, 20)}.${randomInt(0, 256)}.${randomInt(1, 254)}`;
  recordClientIp(rt, ip);
  return ip;
}

/** A password that satisfies the policy (12 to 128 characters). */
export function newPassword(): string {
  return `E2e-${randomBytes(9).toString('hex')}-Pw`;
}

export interface SiteSummary {
  readonly key: string;
  readonly name: string;
  readonly domains: readonly string[];
  readonly status: string;
}

export interface UserSummary {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly banned: boolean;
  readonly siteKeys: readonly string[];
}

/**
 * The dashboard API as a browser-less client, for set-up and for assertions on raw responses.
 * It talks to the same origin as the UI (the `vite preview` server proxies `/api`) and sends the
 * `Origin` header that Better Auth and the CSRF check expect on writes.
 */
export class DashboardClient {
  /** Set by `firstLogin`: the credentials after the one-time password was replaced. */
  credentials: Credentials | undefined;
  readonly http: APIRequestContext;
  readonly clientIp: string;

  private constructor(http: APIRequestContext, clientIp: string) {
    this.http = http;
    this.clientIp = clientIp;
  }

  static async create(rt: Runtime): Promise<DashboardClient> {
    const clientIp = randomClientIp(rt);
    const http = await request.newContext({
      baseURL: rt.dashboardOrigin,
      extraHTTPHeaders: { Origin: rt.dashboardOrigin, 'X-Forwarded-For': clientIp },
    });
    return new DashboardClient(http, clientIp);
  }

  /** Signs in, changes the one-time password, and returns the new credentials. */
  static async firstLogin(rt: Runtime, initial: Credentials): Promise<DashboardClient> {
    const client = await DashboardClient.create(rt);
    await client.signIn(initial);
    const next = newPassword();
    await client.changePassword(initial.password, next);
    client.credentials = { email: initial.email, password: next };
    return client;
  }

  async signIn(credentials: Credentials): Promise<APIResponse> {
    const response = await this.http.post('/api/auth/sign-in/email', { data: credentials });
    expect(response.status(), 'sign-in').toBe(200);
    return response;
  }

  async changePassword(current: string, next: string): Promise<void> {
    const response = await this.http.post('/api/auth/change-password', {
      data: { currentPassword: current, newPassword: next, revokeOtherSessions: false },
    });
    expect(response.status(), 'change-password').toBe(200);
  }

  async json<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    path: string,
    data?: unknown,
    status = 200,
  ) {
    const response = await this.http.fetch(path, {
      method,
      ...(data === undefined ? {} : { data }),
    });
    expect(response.status(), `${method} ${path}`).toBe(status);
    return (await response.json()) as T;
  }

  createSite(site: { key: string; name: string; domains: string[] }): Promise<SiteSummary> {
    return this.json('POST', '/api/admin/sites', { ...site, policyPreset: 'eu-opt-in' }, 201);
  }

  async createUser(user: {
    name: string;
    email: string;
    siteKeys: string[];
  }): Promise<{ user: UserSummary; oneTimePassword: string }> {
    return this.json('POST', '/api/admin/users', { ...user, role: 'user' }, 201);
  }

  async listUsers(): Promise<UserSummary[]> {
    return (await this.json<{ items: UserSummary[] }>('GET', '/api/admin/users')).items;
  }

  async dispose(): Promise<void> {
    await this.http.dispose();
  }
}
