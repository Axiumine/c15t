// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  info: (message: string, fields?: LogFields) => void;
  warn: (message: string, fields?: LogFields) => void;
  error: (message: string, fields?: LogFields) => void;
}

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/**
 * Only the name, message and code of an error are logged. Driver errors and `URL` parse errors
 * can carry the connection string (with its password) in other properties.
 */
export function errorFields(error: unknown): LogFields {
  if (typeof error !== 'object' || error === null) return { error: String(error) };
  const { name, message, code } = error as { name?: unknown; message?: unknown; code?: unknown };
  return {
    error: typeof name === 'string' ? name : 'Error',
    message: typeof message === 'string' ? message : undefined,
    code: typeof code === 'string' ? code : undefined,
  };
}

/** One JSON object per line: stdout for info, stderr for the rest (journald keeps the split). */
export function createLogger(
  write: (stream: 'out' | 'err', line: string) => void = (stream, line) => {
    (stream === 'out' ? process.stdout : process.stderr).write(`${line}\n`);
  },
): Logger {
  const emit =
    (level: 'info' | 'warn' | 'error') =>
    (message: string, fields: LogFields = {}): void => {
      write(
        level === 'info' ? 'out' : 'err',
        JSON.stringify({ time: new Date().toISOString(), level, msg: message, ...fields }),
      );
    };
  return { info: emit('info'), warn: emit('warn'), error: emit('error') };
}
