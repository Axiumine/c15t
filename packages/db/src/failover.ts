// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

/*
 * Patroni failover handling (CLAUDE.md "PostgreSQL"). A switchover or failover surfaces as one
 * of a few errors; the caller returns 503 and retries only idempotent reads.
 */

import { fieldOf } from '@consent/shared';

const MAX_CAUSE_DEPTH = 6;

/** SQLSTATEs that mean "this connection went to a demoted, stopping or unreachable node". */
export const FAILOVER_SQLSTATES: ReadonlySet<string> = new Set([
  '25006', // read_only_sql_transaction: write on a demoted primary
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now (starting up, in recovery)
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '08006', // connection_failure
  '08007', // transaction_resolution_unknown
  '08P01', // protocol_violation after an abrupt close
]);

/** Node socket errors and postgres.js connection error codes. */
export const FAILOVER_ERROR_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  'CONNECT_TIMEOUT',
  'CONNECTION_CLOSED',
  'CONNECTION_DESTROYED',
  'CONNECTION_ENDED',
]);

function* causeChain(error: unknown): Generator<unknown> {
  let current: unknown = error;
  for (
    let depth = 0;
    depth < MAX_CAUSE_DEPTH && current !== undefined && current !== null;
    depth++
  ) {
    yield current;
    current = fieldOf(current, 'cause');
  }
}

/** The `code` of the first error in the cause chain that has a string one (Drizzle wraps errors). */
export function dbErrorCode(error: unknown): string | undefined {
  for (const candidate of causeChain(error)) {
    const code = fieldOf(candidate, 'code');
    if (typeof code === 'string') return code;
  }
  return undefined;
}

/** True for errors that a failover or a stale connection after a DNS flip produces. */
export function isFailoverError(error: unknown): boolean {
  for (const candidate of causeChain(error)) {
    const code = fieldOf(candidate, 'code');
    if (
      typeof code === 'string' &&
      (FAILOVER_SQLSTATES.has(code) || FAILOVER_ERROR_CODES.has(code))
    ) {
      return true;
    }
  }
  return false;
}

/** Unique violation (23505). Pass the constraint name to tell which one was hit. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  for (const candidate of causeChain(error)) {
    if (fieldOf(candidate, 'code') === '23505') {
      return constraint === undefined || fieldOf(candidate, 'constraint_name') === constraint;
    }
  }
  return false;
}

export interface RetryReadOptions {
  /** Retries after the first attempt. Default 1. */
  readonly retries?: number;
  /** Wait before each retry, in milliseconds. Default 150. */
  readonly delayMs?: number;
}

/**
 * Re-runs `read` after a failover error, so the pool gets a fresh connection to the new leader.
 * Only wrap idempotent reads. Writes must never go through this: a write that failed mid-flight
 * may have committed.
 */
export async function retryRead<T>(
  read: () => Promise<T>,
  options: RetryReadOptions = {},
): Promise<T> {
  const retries = options.retries ?? 1;
  const delayMs = options.delayMs ?? 150;
  for (let attempt = 0; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      if (attempt >= retries || !isFailoverError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
