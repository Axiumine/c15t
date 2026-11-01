// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { randomInt } from 'node:crypto';
import { type Database, rateLimit, site, siteMember } from '@consent/db';
import type { Role } from '@consent/shared';
import { like, or } from 'drizzle-orm';
import { createApp } from '../app.js';
import { type Auth, createAuth } from '../auth.js';
import { type AppDatabase, wrapDatabase } from '../db.js';
import { createLogger, type Logger } from '../logger.js';
import { generatePassword } from '../password.js';
import type { TestEnvironment } from './environment.js';

export const TEST_ORIGIN = 'https://dashboard.example.test';
// Not a real secret: it only has to be long enough for the env schema.
const TEST_SECRET = 'test-only-secret-test-only-secret-0123456789';

export interface TestUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
  readonly role: Role;
}

export interface RequestOptions {
  readonly cookie?: string;
  readonly json?: unknown;
  readonly ip?: string;
  readonly headers?: Record<string, string>;
  /** Leave the Origin header out (a cross-site or scripted request). */
  readonly noOrigin?: boolean;
}

export interface TestApp {
  readonly app: ReturnType<typeof createApp>;
  readonly auth: Auth;
  readonly db: AppDatabase;
  readonly env: TestEnvironment;
  /** Every line the app logged. */
  readonly logs: string[];
  request(method: string, path: string, options?: RequestOptions): Promise<Response>;
  /** Signs in and returns the cookie header to send on later requests. */
  signIn(user: Pick<TestUser, 'email' | 'password'>): Promise<string>;
  createUser(options?: {
    role?: Role;
    mustChangePassword?: boolean;
    label?: string;
  }): Promise<TestUser>;
  /** A site row with a prefixed key. Pass `members` to assign users. */
  createSite(options?: {
    label?: string;
    status?: 'active' | 'disabled';
    members?: readonly TestUser[];
  }): Promise<{ key: string; id: string }>;
  /** A fresh client IP, so the login rate limit of one test never hits another. */
  nextIp(): string;
  close(): Promise<void>;
}

/**
 * Closes what `beforeAll` created. `afterAll` also runs when `beforeAll` failed before it assigned
 * the variable, and then the setup error is the one to report, not a TypeError from the cleanup.
 */
export async function closeIfOpen(resource: { close(): Promise<void> } | undefined): Promise<void> {
  await resource?.close();
}

export interface TestAppOptions {
  /** Replaces the analytics pool, e.g. with a wrapper that counts or fails queries. */
  readonly analytics?: Database;
}

/** Cookie, Origin, client IP and, for a JSON body, the content type of a test request. */
function requestHeaders(init: RequestOptions, ip: string): Headers {
  const headers = new Headers(init.headers);
  if (init.cookie !== undefined) headers.set('cookie', init.cookie);
  if (init.noOrigin !== true) headers.set('origin', TEST_ORIGIN);
  headers.set('x-forwarded-for', ip);
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  return headers;
}

export function createTestApp(env: TestEnvironment, options: TestAppOptions = {}): TestApp {
  const logs: string[] = [];
  const logger: Logger = createLogger((line) => {
    logs.push(line);
  });
  const db = wrapDatabase({ ...env.pools, analytics: options.analytics ?? env.pools.analytics });
  const auth = createAuth({
    db,
    env: { BETTER_AUTH_SECRET: TEST_SECRET, BETTER_AUTH_URL: TEST_ORIGIN },
    logger,
  });
  const app = createApp({ env: { BETTER_AUTH_URL: TEST_ORIGIN }, db, auth, logger });

  const usedIps = new Set<string>();
  const nextIp = () => {
    // 198.18.0.0/15 (benchmarking range, ~131k addresses): concurrent runs on the shared database
    // practically never share a rate-limit key. The 17 random bits are drawn until unused.
    let ip: string;
    do {
      const bits = randomInt(1 << 17);
      ip = `198.${18 + (bits >> 16)}.${(bits >> 8) & 0xff}.${bits & 0xff || 1}`;
    } while (usedIps.has(ip));
    usedIps.add(ip);
    return ip;
  };
  const runIp = nextIp();

  const request: TestApp['request'] = (method, path, init = {}) => {
    const ip = init.ip ?? runIp;
    usedIps.add(ip);
    const headers = requestHeaders(init, ip);
    const body = init.json === undefined ? undefined : JSON.stringify(init.json);
    return Promise.resolve(
      app.request(`${TEST_ORIGIN}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
      }),
    );
  };

  const signIn: TestApp['signIn'] = async (user) => {
    const response = await request('POST', '/api/auth/sign-in/email', {
      json: { email: user.email, password: user.password },
      ip: nextIp(),
    });
    if (response.status !== 200) throw new Error(`sign-in failed with status ${response.status}`);
    return cookieHeader(response);
  };

  const createUser: TestApp['createUser'] = async (opts = {}) => {
    const role = opts.role ?? 'user';
    const password = generatePassword();
    const email = `${env.prefix}-${opts.label ?? role}-${randomInt(1_000_000)}@example.test`;
    const created = await auth.api.createUser({
      body: {
        email,
        name: `Test ${role}`,
        password,
        role,
        data: { mustChangePassword: opts.mustChangePassword ?? false },
      },
    });
    return { id: created.user.id, email, password, role };
  };

  const createSite: TestApp['createSite'] = async (opts = {}) => {
    const key = `${env.prefix}-${opts.label ?? randomInt(1_000_000)}`;
    const [row] = await db.primary
      .insert(site)
      .values({
        key,
        name: `Site ${key}`,
        domains: [`${key}.example.test`],
        status: opts.status ?? 'active',
      })
      .returning({ id: site.id, key: site.key });
    if (row === undefined) throw new Error('site insert returned no row');
    if (opts.members !== undefined && opts.members.length > 0) {
      await db.primary
        .insert(siteMember)
        .values(opts.members.map((member) => ({ userId: member.id, siteId: row.id })));
    }
    return row;
  };

  return {
    app,
    auth,
    db,
    env,
    logs,
    request,
    signIn,
    createUser,
    createSite,
    nextIp,
    close: async () => {
      const keys = [...usedIps].map((ip) => like(rateLimit.key, `${ip}|%`));
      if (keys.length > 0) await db.primary.delete(rateLimit).where(or(...keys));
    },
  };
}

/** `name=value` pairs of every Set-Cookie header, joined for a Cookie request header. */
export function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .filter((pair): pair is string => pair !== undefined && !pair.endsWith('='))
    .join('; ');
}

export async function jsonOf(response: Response): Promise<unknown> {
  return response.json();
}
