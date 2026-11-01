// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

/*
 * JSON-line logger. Callers pass only identifiers and codes: never request bodies, headers,
 * cookies, passwords or query strings (they can carry subject IDs).
 */

export type LogLevel = 'info' | 'warn' | 'error';
export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export function createLogger(write: (line: string, level: LogLevel) => void): Logger {
  const log = (level: LogLevel, message: string, fields: LogFields = {}) => {
    write(JSON.stringify({ time: new Date().toISOString(), level, message, ...fields }), level);
  };
  return {
    info: (message, fields) => log('info', message, fields),
    warn: (message, fields) => log('warn', message, fields),
    error: (message, fields) => log('error', message, fields),
  };
}

export const consoleLogger: Logger = createLogger((line, level) => {
  (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
});

export const silentLogger: Logger = createLogger(() => undefined);

const MAX_ERROR_MESSAGE = 300;

/**
 * The text before the first line break. A stack trace or bound SQL parameters may follow the
 * first line of an error message, so the log keeps only that line.
 */
export function firstLine(text: string): string {
  const end = text.indexOf('\n');
  return end === -1 ? text : text.slice(0, end);
}

/**
 * Safe description of an unexpected error for the log. Drizzle appends the bound parameters on
 * a second line of its message, so only the first line is kept.
 */
export function describeError(error: unknown): LogFields {
  if (!(error instanceof Error)) return { errorName: typeof error };
  const code = (error as { code?: unknown }).code;
  const cause = (error as { cause?: unknown }).cause;
  const causeCode =
    typeof cause === 'object' && cause !== null ? (cause as { code?: unknown }).code : undefined;
  return {
    errorName: error.name,
    errorMessage: firstLine(error.message).slice(0, MAX_ERROR_MESSAGE),
    ...(typeof code === 'string' ? { errorCode: code } : {}),
    ...(typeof causeCode === 'string' ? { causeCode } : {}),
  };
}
