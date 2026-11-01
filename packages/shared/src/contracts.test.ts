// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { auditEntrySchema } from './audit.js';
import { ipInCidrs } from './cidr.js';
import { consentExportQuerySchema, rangeBoundSchema, statsQuerySchema } from './consent-query.js';
import { consentRecordSchema } from './consents.js';
import { domainSchema, domainsSchema } from './domain.js';
import { parseCidr, parseIp } from './ip.js';
import { cidrListSchema, cidrSchema, portSchema } from './network.js';
import { originSchema } from './origin.js';
import { POLICY_PRESET_RULES } from './policy.js';
import { siteKeySchema, siteSchema, siteSetupSchema, siteUpdateSchema } from './site.js';
import { statsResponseSchema } from './stats.js';
import { NO_NUL_MESSAGE, noNul } from './text.js';
import {
  changePasswordSchema,
  membershipSchema,
  meSchema,
  userCreateSchema,
  userSitesSchema,
  userSummarySchema,
  userUpdateSchema,
} from './user.js';

/*
 * Contracts that no other test pinned down, found by mutation testing (docs/quality-gates.md): the
 * text of validation messages (operators and the dashboard show them), boundaries, the exact
 * policy presets, and the date format the API accepts. Each assertion below failed against a
 * mutant that the rest of the suite let through.
 */

function issues(schema: z.ZodType, input: unknown) {
  const result = schema.safeParse(input);
  if (result.success) throw new Error(`expected ${JSON.stringify(input)} to be rejected`);
  return result.error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
}

const messages = (schema: z.ZodType, input: unknown) =>
  issues(schema, input).map((issue) => issue.message);

describe('validation messages', () => {
  test('site key and domains', () => {
    expect(messages(siteKeySchema, 'AB')).toEqual([
      'siteKey must be 3 to 40 characters: a-z, 0-9 and hyphen',
    ]);
    expect(messages(domainSchema, '*.example.com')).toContain('Wildcards are not allowed');
    expect(messages(domainSchema, 'not a host')).toContain(
      'Must be a host name such as shop.example.com',
    );
    expect(messages(domainSchema, 'example.com:0')).toContain('Port must be between 1 and 65535');
    expect(messages(domainSchema, 'example.com:65536')).toContain(
      'Port must be between 1 and 65535',
    );
    expect(messages(domainsSchema, [])).toEqual(['At least one domain is required']);
    expect(messages(domainsSchema, ['a.example.com', 'a.example.com'])).toEqual([
      'Domains must be unique',
    ]);
  });

  test('an update must change something, and `undefined` is not a change', () => {
    const message = 'Provide at least one field to change';
    expect(messages(siteUpdateSchema, {})).toEqual([message]);
    expect(messages(siteUpdateSchema, { name: undefined })).toEqual([message]);
    expect(messages(userUpdateSchema, {})).toEqual([message]);
    expect(messages(userUpdateSchema, { name: undefined })).toEqual([message]);
    expect(siteUpdateSchema.safeParse({ status: 'disabled' }).success).toBe(true);
    expect(userUpdateSchema.safeParse({ role: 'admin' }).success).toBe(true);
  });

  test('users: unique site keys, a new password that differs, no NUL', () => {
    expect(messages(userSitesSchema, { siteKeys: ['site-one', 'site-one'] })).toEqual([
      'Site keys must be unique',
    ]);
    expect(
      issues(changePasswordSchema, {
        currentPassword: 'the-same-password-1',
        newPassword: 'the-same-password-1',
      }),
    ).toEqual([
      { path: ['newPassword'], message: 'The new password must differ from the current one' },
    ]);
    expect(messages(noNul(z.string()), 'a\u0000b')).toEqual([NO_NUL_MESSAGE]);
    expect(NO_NUL_MESSAGE).toBe('Must not contain the NUL character (U+0000)');
  });

  test('a user name is trimmed', () => {
    const parsed = userCreateSchema.parse({ name: '  Ada  ', email: 'ada@example.com' });
    expect(parsed.name).toBe('Ada');
  });

  test('a membership needs a user, a site key and a date', () => {
    expect(membershipSchema.safeParse({}).success).toBe(false);
    expect(
      membershipSchema.safeParse({
        userId: 'u1',
        siteKey: 'site-one',
        createdAt: '2026-03-01T12:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  test('network settings', () => {
    expect(messages(portSchema, 'abc')).toEqual(['Port must be a decimal integer']);
    expect(messages(portSchema, '80')).toEqual(['Port must be 1024 or higher']);
    expect(messages(cidrSchema, 'nope')).toEqual(['Must be a CIDR such as 10.0.0.0/8 or fd00::/8']);
    expect(cidrSchema.parse(' 127.0.0.1/32 ')).toBe('127.0.0.1/32');
    expect(messages(cidrListSchema, ' , ')).toEqual(['At least one CIDR is required']);
    expect(cidrListSchema.parse('127.0.0.1/32 , ::1/128')).toEqual(['127.0.0.1/32', '::1/128']);
    const origin = 'Must be an http(s) origin without path, query or credentials';
    expect(messages(originSchema, 'not a url')).toEqual([origin]);
    expect(messages(originSchema, 'https://example.com/path')).toEqual([origin]);
    expect(messages(originSchema, 'ftp://example.com')).toEqual([origin]);
    expect(originSchema.parse(' https://example.com ')).toBe('https://example.com');
  });

  test('range bounds', () => {
    expect(messages(rangeBoundSchema, '0000-01-01')).toEqual([
      'Must be between the years 0001 and 9999',
    ]);
    expect(issues(consentExportQuerySchema, { from: '2026-03-02', to: '2026-03-01' })).toEqual([
      { path: ['from'], message: '`from` must not be after `to`' },
    ]);
  });
});

describe('boundaries', () => {
  test('a range from a day to the same day is allowed', () => {
    expect(
      consentExportQuerySchema.safeParse({ from: '2026-03-01', to: '2026-03-01' }).success,
    ).toBe(true);
    expect(statsQuerySchema.safeParse({ from: '2026-03-01', to: '2026-03-01' }).success).toBe(true);
    expect(
      statsQuerySchema.safeParse({
        from: '2026-03-01T10:00:00.000Z',
        to: '2026-03-01T10:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});

describe('dates with an offset are accepted wherever the API sends a date-time', () => {
  const withOffset = '2026-03-01T12:00:00+02:00';

  test.each([
    ['consent givenAt', consentRecordSchema.shape.givenAt],
    ['audit createdAt', auditEntrySchema.shape.createdAt],
    ['site createdAt', siteSchema.shape.createdAt],
    ['site updatedAt', siteSchema.shape.updatedAt],
    ['user createdAt', userSummarySchema.shape.createdAt],
  ])('%s', (_name, schema) => {
    expect(schema.safeParse(withOffset).success).toBe(true);
    expect(schema.safeParse('2026-03-01T12:00:00Z').success).toBe(true);
    expect(schema.safeParse('2026-03-01').success).toBe(false);
    expect(schema.safeParse('yesterday').success).toBe(false);
  });

  test('the user ban expiry, which may also be null', () => {
    const { banExpires } = userSummarySchema.shape;
    expect(banExpires.safeParse(withOffset).success).toBe(true);
    expect(banExpires.safeParse(null).success).toBe(true);
    expect(banExpires.safeParse('soon').success).toBe(false);
  });
});

describe('policy presets', () => {
  test('each preset is exactly these c15t rule factories, in this order', () => {
    expect(POLICY_PRESET_RULES).toEqual({
      'eu-opt-in': ['europeOptIn', 'worldNone'],
      'eu-us-opt-out': ['europeOptIn', 'quebecOptIn', 'usPrivacyStatesOptOut', 'worldNone'],
      'global-preferences': [
        'europeOptIn',
        'quebecOptIn',
        'usPrivacyStatesOptOut',
        'worldOptOutNoPrompt',
      ],
    });
  });
});

describe('IP parsing and CIDR matching edge cases', () => {
  test('text that is not an IPv6 address', () => {
    expect(parseIp('1234')).toBeNull();
    expect(parseIp('fe80::1%eth0')).toBeNull();
    expect(parseIp('1::2::3')).toBeNull();
    expect(parseIp('1:2:3:4::5:6:7:8')).toBeNull();
    expect(parseIp('1:2:3:4:5:6:7')).toBeNull();
  });

  test('a "::" may stand for exactly one zero group', () => {
    expect(parseIp('1:2:3:4::5:6:7')?.version).toBe(6);
    expect(parseIp('1:2:3:4:5:6:7::')?.version).toBe(6);
    expect(parseIp('::')?.version).toBe(6);
  });

  test('a CIDR needs one slash and a decimal prefix of at most three digits', () => {
    expect(parseCidr('10.0.0.1')).toBeNull();
    expect(parseCidr('10.0.0.0/')).toBeNull();
    expect(parseCidr('10.0.0.0/24x')).toBeNull();
    expect(parseCidr('::1/12x')).toBeNull();
    expect(parseCidr('10.0.0.0/1234')).toBeNull();
    expect(parseCidr('10.0.0.0/33')).toBeNull();
    expect(parseCidr('::1/129')).toBeNull();
    expect(parseCidr('10.0.0.0/24')).toEqual({ version: 4, value: 167_772_160n, prefix: 24 });
  });

  test('an IPv4 peer matches an IPv4-mapped IPv6 CIDR of /96 or longer, and nothing shorter', () => {
    expect(ipInCidrs('1.2.3.4', ['::ffff:0:0/96'])).toBe(true);
    expect(ipInCidrs('1.2.3.4', ['::ffff:1.2.3.4/128'])).toBe(true);
    expect(ipInCidrs('1.2.3.4', ['::ffff:1.2.3.5/128'])).toBe(false);
    // A shorter IPv6 prefix says nothing about IPv4 peers: `::/0` must not trust the whole IPv4 space.
    expect(ipInCidrs('1.2.3.4', ['::/0'])).toBe(false);
    expect(ipInCidrs('1.2.3.4', ['::/95'])).toBe(false);
    // And the other way round.
    expect(ipInCidrs('2001:db8::1', ['10.0.0.0/8'])).toBe(false);
  });
});

describe('response contracts reject an answer with a missing part', () => {
  const stats = {
    range: { from: '2026-03-01T00:00:00.000Z', to: '2026-03-02T00:00:00.000Z' },
    totals: { consents: 3, subjects: 2 },
    volume: [{ date: '2026-03-01', consents: 3 }],
    purposes: [{ purpose: 'measurement', granted: 2, denied: 1, optInRate: 2 / 3 }],
    jurisdictions: [{ jurisdiction: 'GDPR', consents: 3 }],
  };

  test('statistics', () => {
    expect(statsResponseSchema.safeParse(stats).success).toBe(true);
    expect(statsResponseSchema.safeParse({ ...stats, range: {} }).success).toBe(false);
    expect(statsResponseSchema.safeParse({ ...stats, totals: {} }).success).toBe(false);
    expect(statsResponseSchema.safeParse({ ...stats, volume: [{}] }).success).toBe(false);
    expect(statsResponseSchema.safeParse({ ...stats, jurisdictions: [{}] }).success).toBe(false);
  });

  test('the setup text and the signed-in user', () => {
    const setup = { nginx: 'n', backendUrl: 'b', scriptTag: 't', serverClient: 'c' };
    expect(siteSetupSchema.safeParse(setup).success).toBe(true);
    expect(siteSetupSchema.safeParse({}).success).toBe(false);
    const me = {
      id: 'u1',
      name: 'Ada',
      email: 'ada@example.com',
      role: 'user',
      mustChangePassword: false,
    };
    expect(meSchema.safeParse(me).success).toBe(true);
    expect(meSchema.safeParse({}).success).toBe(false);
  });
});
