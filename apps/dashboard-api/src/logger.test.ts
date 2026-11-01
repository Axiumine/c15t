// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { afterEach, expect, test, vi } from 'vitest';
import {
  consoleLogger,
  createLogger,
  describeError,
  firstLine,
  type LogLevel,
  silentLogger,
} from './logger.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function capture() {
  const written: { line: string; level: LogLevel }[] = [];
  return { written, logger: createLogger((line, level) => written.push({ line, level })) };
}

test('writes one JSON line per call with the time, level, message and fields', () => {
  vi.useFakeTimers({ now: new Date('2026-03-01T12:00:00.000Z') });
  const { written, logger } = capture();
  logger.info('hello', { siteKey: 'shop' });
  logger.warn('careful');
  logger.error('broken', { code: 'X' });
  expect(written.map((entry) => entry.level)).toEqual(['info', 'warn', 'error']);
  expect(written.map((entry) => JSON.parse(entry.line) as unknown)).toEqual([
    { time: '2026-03-01T12:00:00.000Z', level: 'info', message: 'hello', siteKey: 'shop' },
    { time: '2026-03-01T12:00:00.000Z', level: 'warn', message: 'careful' },
    { time: '2026-03-01T12:00:00.000Z', level: 'error', message: 'broken', code: 'X' },
  ]);
  for (const entry of written) expect(entry.line).not.toContain('\n');
});

test('the consoleLogger sends errors to stderr and everything else to stdout', () => {
  const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  consoleLogger.info('one');
  consoleLogger.warn('two');
  consoleLogger.error('three');
  const messageOf = ([chunk]: readonly unknown[]) =>
    (JSON.parse(String(chunk)) as { message: string }).message;
  expect(out.mock.calls.map(messageOf)).toEqual(['one', 'two']);
  expect(err.mock.calls.map(messageOf)).toEqual(['three']);
  expect(String(out.mock.calls[0]?.[0]).endsWith('\n')).toBe(true);
});

test('the silentLogger writes nothing', () => {
  const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  silentLogger.info('a');
  silentLogger.warn('b');
  silentLogger.error('c', { code: 'X' });
  expect(out).not.toHaveBeenCalled();
  expect(err).not.toHaveBeenCalled();
});

test('describeError reports only the type of a value that is not an Error', () => {
  expect(describeError('secret text')).toEqual({ errorName: 'string' });
  expect(describeError(undefined)).toEqual({ errorName: 'undefined' });
  expect(describeError({ message: 'x' })).toEqual({ errorName: 'object' });
});

test('describeError keeps the name, the first line of the message and string codes', () => {
  const error = Object.assign(new TypeError('first line\nparams: ["secret"]'), { code: '23505' });
  expect(describeError(error)).toEqual({
    errorName: 'TypeError',
    errorMessage: 'first line',
    errorCode: '23505',
  });
});

test('describeError adds the code of the cause and ignores codes that are not strings', () => {
  const cause = Object.assign(new Error('inner'), { code: '57P01' });
  expect(describeError(new Error('outer', { cause }))).toEqual({
    errorName: 'Error',
    errorMessage: 'outer',
    causeCode: '57P01',
  });
  const numeric = Object.assign(new Error('outer', { cause: { code: 42 } }), { code: 7 });
  expect(describeError(numeric)).toEqual({ errorName: 'Error', errorMessage: 'outer' });
});

test('describeError ignores a cause that is not an object', () => {
  expect(describeError(new Error('outer', { cause: 'text' }))).toEqual({
    errorName: 'Error',
    errorMessage: 'outer',
  });
  expect(describeError(new Error('outer', { cause: null }))).toEqual({
    errorName: 'Error',
    errorMessage: 'outer',
  });
});

test('describeError truncates a long message and copes with an empty first line', () => {
  expect(describeError(new Error('x'.repeat(1000)))).toMatchObject({
    errorMessage: 'x'.repeat(300),
  });
  expect(describeError(new Error('\nonly the second line'))).toMatchObject({ errorMessage: '' });
  expect(describeError(new Error(''))).toMatchObject({ errorMessage: '' });
});

test('firstLine keeps the text before the first line break and leaves single lines alone', () => {
  expect(firstLine('one\ntwo\nthree')).toBe('one');
  expect(firstLine('one\r\ntwo')).toBe('one\r');
  expect(firstLine('\nonly the second line')).toBe('');
  expect(firstLine('no break')).toBe('no break');
  expect(firstLine('')).toBe('');
});
