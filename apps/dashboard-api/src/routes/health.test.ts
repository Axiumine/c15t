// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { afterEach, expect, test, vi } from 'vitest';
import { healthRoutes } from './health.js';

afterEach(() => {
  vi.useRealTimers();
});

async function health(ping: () => Promise<void>) {
  const response = await healthRoutes({ db: { ping } }).request('/');
  return { status: response.status, body: await response.json() };
}

test('reports ok when the primary answers the ping', async () => {
  expect(await health(async () => undefined)).toEqual({
    status: 200,
    body: { status: 'ok', db: true },
  });
});

test('reports degraded, still with 200, when the ping fails', async () => {
  expect(await health(() => Promise.reject(new Error('connection refused')))).toEqual({
    status: 200,
    body: { status: 'degraded', db: false },
  });
});

test('reports degraded when the ping does not answer within the timeout', async () => {
  vi.useFakeTimers();
  const request = health(() => new Promise<void>(() => undefined));
  await vi.advanceTimersByTimeAsync(1999);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await request).toEqual({ status: 200, body: { status: 'degraded', db: false } });
});

test('clears the timeout once the ping has answered', async () => {
  vi.useFakeTimers();
  const request = health(async () => undefined);
  await vi.advanceTimersByTimeAsync(0);
  expect(await request).toMatchObject({ body: { status: 'ok', db: true } });
  expect(vi.getTimerCount()).toBe(0);
});
