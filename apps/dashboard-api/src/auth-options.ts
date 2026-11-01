// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { BetterAuthOptions } from 'better-auth';
import { firstLine, type Logger } from './logger.js';

const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 7;
const SESSION_REFRESH_SECONDS = 60 * 60 * 24;

/** Failed logins per client IP: 10 in five minutes (README "Security notes"). */
const LOGIN_RATE_LIMIT = { window: 300, max: 10 } as const;
const PASSWORD_RATE_LIMIT = { window: 300, max: 10 } as const;
const DEFAULT_RATE_LIMIT = { window: 60, max: 120 } as const;

/** No cookie cache: a ban, a revoked session or a role change takes effect on the next request. */
export const SESSION_OPTIONS: NonNullable<BetterAuthOptions['session']> = {
  expiresIn: SESSION_LIFETIME_SECONDS,
  updateAge: SESSION_REFRESH_SECONDS,
  cookieCache: { enabled: false },
};

export const RATE_LIMIT_OPTIONS: NonNullable<BetterAuthOptions['rateLimit']> = {
  enabled: true,
  storage: 'database',
  ...DEFAULT_RATE_LIMIT,
  customRules: {
    '/sign-in/email': LOGIN_RATE_LIMIT,
    '/change-password': PASSWORD_RATE_LIMIT,
  },
};

export function advancedOptions(secure: boolean): NonNullable<BetterAuthOptions['advanced']> {
  return {
    cookiePrefix: 'c15t-dashboard',
    useSecureCookies: secure,
    defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure },
    // nginx sets X-Forwarded-For from the real visitor IP (CLAUDE.md "Credentials").
    ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
  };
}

export function authLogger(logger: Logger): NonNullable<BetterAuthOptions['logger']> {
  return {
    level: 'warn',
    log: (level, message) => {
      // First line only, like `describeError`: a stack or SQL parameters may follow it.
      const line = firstLine(message).slice(0, 300);
      if (level === 'error') logger.error('better-auth', { detail: line });
      else if (level === 'warn') logger.warn('better-auth', { detail: line });
    },
  };
}
