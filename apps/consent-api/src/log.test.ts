// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { afterEach, describe, expect, test, vi } from 'vitest';
import { createLogger, errorFields, silentLogger } from './log.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('errorFields', () => {
  test('keeps the name, message and code of an error', () => {
    const error = Object.assign(new TypeError('connection refused'), { code: 'ECONNREFUSED' });
    expect(errorFields(error)).toEqual({
      error: 'TypeError',
      message: 'connection refused',
      code: 'ECONNREFUSED',
    });
  });

  test('never copies other properties: a driver error can carry the connection string', () => {
    const error = Object.assign(new Error('boom'), {
      url: 'postgres://user:hunter2@db.internal/app',
      connection: { password: 'hunter2' },
    });
    expect(JSON.stringify(errorFields(error))).not.toContain('hunter2');
  });

  test('falls back for an object whose fields are not strings', () => {
    expect(errorFields({ name: 7, message: { text: 'x' }, code: 42 })).toEqual({
      error: 'Error',
      message: undefined,
      code: undefined,
    });
    expect(errorFields({})).toEqual({ error: 'Error', message: undefined, code: undefined });
  });

  test.each([
    ['a string', 'plain failure', 'plain failure'],
    ['a number', 404, '404'],
    ['undefined', undefined, 'undefined'],
    ['null', null, 'null'],
  ])('describes %s without reading it', (_label, value, text) => {
    expect(errorFields(value)).toEqual({ error: text });
  });
});

describe('createLogger', () => {
  test('writes one JSON object per line, info to out and the rest to err', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-06T07:08:09.010Z'));
    const lines: Array<[string, string]> = [];
    const log = createLogger((stream, line) => lines.push([stream, line]));

    log.info('hello', { siteKey: 'shop' });
    log.warn('careful');
    log.error('broken', { code: 'X1' });

    expect(lines.map(([stream]) => stream)).toEqual(['out', 'err', 'err']);
    expect(lines.map(([, line]) => JSON.parse(line))).toEqual([
      { time: '2026-05-06T07:08:09.010Z', level: 'info', msg: 'hello', siteKey: 'shop' },
      { time: '2026-05-06T07:08:09.010Z', level: 'warn', msg: 'careful' },
      { time: '2026-05-06T07:08:09.010Z', level: 'error', msg: 'broken', code: 'X1' },
    ]);
  });

  test('by default info goes to stdout and the rest to stderr, each line newline-terminated', () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const log = createLogger();

    log.info('to stdout');
    log.warn('to stderr');
    log.error('also stderr');

    expect(out).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledTimes(2);
    const written = String(out.mock.calls[0]?.[0]);
    expect(written.endsWith('\n')).toBe(true);
    expect(JSON.parse(written)).toMatchObject({ level: 'info', msg: 'to stdout' });
    expect(JSON.parse(String(err.mock.calls[1]?.[0]))).toMatchObject({
      level: 'error',
      msg: 'also stderr',
    });
  });
});

describe('silentLogger', () => {
  test('discards everything', () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    silentLogger.info('x');
    silentLogger.warn('x');
    silentLogger.error('x', { a: 1 });
    expect(out).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });
});
