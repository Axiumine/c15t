// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { createMemoryHistory } from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import { AppProviders, createApp } from '../app';

export interface MockRequest {
  readonly method: string;
  readonly url: URL;
  /** Parsed JSON body, or `undefined` when the request had none. */
  readonly body: unknown;
  readonly credentials: RequestCredentials;
}

export type Handler = (
  request: MockRequest,
) => Response | undefined | Promise<Response | undefined>;

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function apiError(
  status: number,
  code: string,
  message = 'Nope',
  issues?: unknown,
): Response {
  return json({ error: { code, message, ...(issues === undefined ? {} : { issues }) } }, status);
}

async function toRequest(input: RequestInfo | URL, init?: RequestInit): Promise<MockRequest> {
  const request =
    input instanceof Request
      ? input
      : new Request(new URL(String(input), window.location.origin), init);
  const text = await request.clone().text();
  return {
    method: request.method.toUpperCase(),
    url: new URL(request.url),
    body: text === '' ? undefined : (JSON.parse(text) as unknown),
    credentials: request.credentials,
  };
}

/**
 * Replaces the global fetch. Handlers are tried in order; the first one that returns a
 * Response wins, anything unhandled is a 404 in the platform's error format.
 */
export function mockFetch(...handlers: Handler[]) {
  const calls: MockRequest[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = await toRequest(input, init);
    calls.push(request);
    for (const handler of handlers) {
      const response = await handler(request);
      if (response !== undefined) return response;
    }
    return apiError(404, 'NOT_FOUND', `unhandled ${request.method} ${request.url.pathname}`);
  });
  vi.stubGlobal('fetch', impl);
  return { calls, fetch: impl };
}

/** Matches `METHOD /path` exactly (query string ignored) and answers with `respond`. */
export function route(
  signature: string,
  respond: Response | ((request: MockRequest) => Response | Promise<Response>),
): Handler {
  const [method, path] = signature.split(' ');
  return (request) => {
    if (request.method !== method || request.url.pathname !== path) return undefined;
    return typeof respond === 'function' ? respond(request) : respond.clone();
  };
}

export function renderApp(path: string) {
  const app = createApp(createMemoryHistory({ initialEntries: [path] }));
  const view = render(<AppProviders app={app} />);
  return { ...app, ...view };
}
