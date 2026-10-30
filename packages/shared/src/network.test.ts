// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { describe, expect, test } from 'vitest';
import {
  cidrListSchema,
  cidrSchema,
  classifyHost,
  hostSchema,
  ipInCidrs,
  originSchema,
  parseCidr,
  parseIp,
  portSchema,
} from './network.js';

describe('hostSchema', () => {
  test.each([
    '127.0.0.1',
    '127.5.6.7',
    '::1',
    'localhost',
    '10.0.0.5',
    '10.255.255.255',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.20',
    '100.64.0.1',
    '100.127.255.254',
    'fc00::1',
    'fd12:3456:789a::1',
    'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
    '::ffff:10.1.2.3',
    '::ffff:127.0.0.1',
  ])('accepts %s', (host) => {
    expect(hostSchema.safeParse(host).success).toBe(true);
  });

  test.each([
    ['0.0.0.0', /wildcard/i],
    ['::', /wildcard/i],
    ['0:0:0:0:0:0:0:0', /wildcard/i],
    ['::ffff:0.0.0.0', /wildcard/i],
    ['8.8.8.8', /public/i],
    ['1.1.1.1', /public/i],
    ['172.15.0.1', /public/i],
    ['172.32.0.1', /public/i],
    ['100.63.255.255', /public/i],
    ['100.128.0.1', /public/i],
    ['192.169.0.1', /public/i],
    ['11.0.0.1', /public/i],
    ['169.254.1.1', /public/i],
    ['2001:db8::1', /public/i],
    ['fe80::1', /public/i],
    ['fbff::1', /public/i],
    ['fe00::1', /public/i],
    ['::ffff:8.8.8.8', /public/i],
    ['example.com', /literal/i],
    ['', /literal/i],
    ['[::1]', /literal/i],
    ['fe80::1%eth0', /literal/i],
    ['127.0.0.1:4100', /literal/i],
    ['256.0.0.1', /literal/i],
    ['010.0.0.1', /literal/i],
    ['10.0.0', /literal/i],
    ['1:2:3:4:5:6:7:8:9', /literal/i],
    ['1::2::3', /literal/i],
    ['::g', /literal/i],
  ])('rejects %s', (host, message) => {
    const result = hostSchema.safeParse(host);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toMatch(message);
  });

  test('trims surrounding whitespace', () => {
    expect(hostSchema.parse(' 10.0.0.1 ')).toBe('10.0.0.1');
  });
});

describe('classifyHost', () => {
  test('separates loopback from private', () => {
    expect(classifyHost('127.0.0.1')).toBe('loopback');
    expect(classifyHost('::1')).toBe('loopback');
    expect(classifyHost('LOCALHOST')).toBe('loopback');
    expect(classifyHost('10.0.0.1')).toBe('private');
    expect(classifyHost('fd00::1')).toBe('private');
  });
});

describe('portSchema', () => {
  test.each([
    [1024, 1024],
    [4100, 4100],
    ['4100', 4100],
    [' 65535 ', 65535],
  ])('accepts %j', (input, expected) => {
    expect(portSchema.parse(input)).toBe(expected);
  });

  test.each([
    1023,
    0,
    65536,
    -1,
    4100.5,
    '',
    'abc',
    '0x1000',
    '1e4',
    '4100abc',
    '-1',
    '123456',
    Number.NaN,
  ])('rejects %j', (input) => {
    expect(portSchema.safeParse(input).success).toBe(false);
  });

  test('works with a default', () => {
    expect(portSchema.default(4100).parse(undefined)).toBe(4100);
  });
});

describe('parseIp', () => {
  test('normalises IPv4-mapped addresses to IPv4', () => {
    expect(parseIp('::ffff:1.2.3.4')).toEqual(parseIp('1.2.3.4'));
    expect(parseIp('::ffff:102:304')).toEqual(parseIp('1.2.3.4'));
  });

  test('parses compressed, full and embedded forms', () => {
    expect(parseIp('::1')?.value).toBe(1n);
    expect(parseIp('0:0:0:0:0:0:0:1')?.value).toBe(1n);
    expect(parseIp('1::')?.value).toBe(1n << 112n);
    expect(parseIp('64:ff9b::1.2.3.4')?.version).toBe(6);
  });

  test('rejects malformed input', () => {
    for (const bad of ['', '1.2.3', '1.2.3.4.5', ':::', '1:2', '12345::', '::1.2.3', 'abc']) {
      expect(parseIp(bad)).toBeNull();
    }
  });
});

describe('CIDR helpers', () => {
  test('cidrSchema validates v4 and v6', () => {
    for (const ok of ['127.0.0.1/32', '0.0.0.0/0', '10.0.0.0/8', '::1/128', 'fc00::/7', '::/0']) {
      expect(cidrSchema.safeParse(ok).success).toBe(true);
    }
    for (const bad of [
      '127.0.0.1',
      '127.0.0.1/33',
      '::1/129',
      '10.0.0.0/-1',
      'x/8',
      '10.0.0.0/',
      '/8',
    ]) {
      expect(cidrSchema.safeParse(bad).success).toBe(false);
    }
  });

  test('parseCidr returns the prefix', () => {
    expect(parseCidr('10.0.0.0/8')).toMatchObject({ version: 4, prefix: 8 });
    expect(parseCidr('fc00::/7')).toMatchObject({ version: 6, prefix: 7 });
    expect(parseCidr('nope')).toBeNull();
  });

  test('cidrListSchema splits, trims and requires one entry', () => {
    expect(cidrListSchema.parse('127.0.0.1/32, ::1/128 ,')).toEqual(['127.0.0.1/32', '::1/128']);
    expect(cidrListSchema.safeParse('').success).toBe(false);
    expect(cidrListSchema.safeParse(' , ').success).toBe(false);
    expect(cidrListSchema.safeParse('127.0.0.1/32,bad').success).toBe(false);
  });

  test('ipInCidrs matches by prefix', () => {
    expect(ipInCidrs('127.0.0.1', ['127.0.0.1/32'])).toBe(true);
    expect(ipInCidrs('127.0.0.2', ['127.0.0.1/32'])).toBe(false);
    expect(ipInCidrs('10.1.2.3', ['10.0.0.0/8'])).toBe(true);
    expect(ipInCidrs('11.0.0.0', ['10.0.0.0/8'])).toBe(false);
    expect(ipInCidrs('1.2.3.4', ['0.0.0.0/0'])).toBe(true);
    expect(ipInCidrs('::1', ['::1/128'])).toBe(true);
    expect(ipInCidrs('fd00::5', ['fc00::/7'])).toBe(true);
    expect(ipInCidrs('fe80::5', ['fc00::/7'])).toBe(false);
  });

  test('ipInCidrs treats IPv4-mapped peers as IPv4', () => {
    expect(ipInCidrs('::ffff:127.0.0.1', ['127.0.0.1/32'])).toBe(true);
    expect(ipInCidrs('::ffff:127.0.0.1', ['::1/128'])).toBe(false);
    expect(ipInCidrs('127.0.0.1', ['::ffff:0:0/96'])).toBe(true);
    expect(ipInCidrs('128.0.0.1', ['::ffff:127.0.0.0/104'])).toBe(false);
    expect(ipInCidrs('127.0.0.1', ['::/0'])).toBe(false);
  });

  test('ipInCidrs never trusts malformed input', () => {
    expect(ipInCidrs('not-an-ip', ['0.0.0.0/0'])).toBe(false);
    expect(ipInCidrs('', ['0.0.0.0/0'])).toBe(false);
    expect(ipInCidrs('127.0.0.1', ['garbage'])).toBe(false);
    expect(ipInCidrs('127.0.0.1', [])).toBe(false);
  });
});

describe('originSchema', () => {
  test('accepts an origin and normalises it', () => {
    expect(originSchema.parse('https://dashboard.example.com')).toBe(
      'https://dashboard.example.com',
    );
    expect(originSchema.parse('http://127.0.0.1:5173/')).toBe('http://127.0.0.1:5173');
    expect(originSchema.parse('HTTPS://Dashboard.Example.com:443')).toBe(
      'https://dashboard.example.com',
    );
  });

  test.each([
    'dashboard.example.com',
    'ftp://example.com',
    'https://example.com/path',
    'https://example.com/?q=1',
    'https://example.com/#x',
    'https://user:pw@example.com',
    '',
  ])('rejects %j', (value) => {
    expect(originSchema.safeParse(value).success).toBe(false);
  });
});
