// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { isFailoverError } from '@consent/db';
import { apiError, ERROR_STATUS, type ErrorCode } from '@consent/shared';
import type { HttpBindings } from '@hono/node-server';
import { getConnInfo } from '@hono/node-server/conninfo';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Input } from 'hono/types';
import { z } from 'zod';
import { SiteConfigError } from './errors.js';
import { errorFields, type Logger, silentLogger } from './log.js';
import type { EvictOutcome, SiteLookup, SiteRegistry } from './registry.js';
import {
  isSafePath,
  requestHostAllowed,
  sanitizeHeaders,
  siteKeyFromPath,
  stripOverrideParams,
} from './request-guard.js';

export type AppEnv = { Bindings: HttpBindings };

// Hono's own `Context<AppEnv>` leaves the route path and the input as `any` and `{}`.
type AppContext = Context<AppEnv, string, Input>;

export interface AppDeps {
  readonly registry: Pick<SiteRegistry, 'use' | 'evict' | 'size'>;
  /** `CONSENT_API_TRUSTED_PROXIES`. */
  readonly trustedProxies: readonly string[];
  /** Rejects when the database or the c15t schema is unreachable. */
  readonly readiness: () => Promise<{ readonly activeSites: number }>;
  readonly listenerState: () => string;
  readonly logger?: Logger;
}

const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const MAX_BODY_BYTES = 1024 * 1024;
const NO_STORE = 'no-store';

const FAILURE_BODY = z.object({ cause: z.object({ code: z.string() }) });
/** c15t answers a failed query with 500 DATABASE_ERROR, and `/status` with 503 SERVICE_UNAVAILABLE. */
const DATABASE_FAILURE_CODES: ReadonlySet<string> = new Set([
  'DATABASE_ERROR',
  'SERVICE_UNAVAILABLE',
]);

type Attempt =
  | { readonly kind: 'response'; readonly response: Response }
  | { readonly kind: 'denied' }
  | { readonly kind: 'database-failure'; readonly outcome: EvictOutcome };

function errorBody(status: number): { code: ErrorCode; message: string } {
  if (status === 404) return { code: 'NOT_FOUND', message: 'Not found.' };
  if (status === 401) return { code: 'UNAUTHORIZED', message: 'Unauthorized.' };
  if (status === 403) return { code: 'FORBIDDEN', message: 'Forbidden.' };
  if (status === 409) return { code: 'CONFLICT', message: 'Conflict.' };
  if (status === 429) return { code: 'RATE_LIMITED', message: 'Too many requests.' };
  if (status === 503) return { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable.' };
  if (status >= 500) return { code: 'INTERNAL_ERROR', message: 'Internal server error.' };
  return { code: 'BAD_REQUEST', message: 'Bad request.' };
}

function jsonError(
  code: ErrorCode,
  message: string,
  // eslint-disable-next-line security/detect-object-injection -- `code` is the closed ErrorCode union
  status = ERROR_STATUS[code],
): Response {
  return Response.json(apiError(code, message), { status });
}

/** The banner calls these routes with `fetch`: whatever goes wrong, it must see JSON, never HTML. */
function asJsonError(response: Response): Response {
  if (response.status < 400 || response.headers.get('content-type')?.includes('json')) {
    return response;
  }
  const { code, message } = errorBody(response.status);
  const headers = new Headers(response.headers);
  for (const name of ['content-type', 'content-length', 'content-encoding', 'etag']) {
    headers.delete(name);
  }
  const body = JSON.stringify(apiError(code, message));
  headers.set('content-type', 'application/json');
  return new Response(body, { status: response.status, headers });
}

async function isDatabaseFailure(response: Response): Promise<boolean> {
  if (response.status !== 500 && response.status !== 503) return false;
  try {
    const parsed = FAILURE_BODY.safeParse(await response.clone().json());
    return parsed.success && DATABASE_FAILURE_CODES.has(parsed.data.cause.code);
  } catch {
    return false;
  }
}

function peerAddress(c: AppContext): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    // No socket behind the request (a test, or a future non-Node runtime): untrusted.
    return undefined;
  }
}

/** The request target as the client wrote it. `new URL` has already resolved `..` in `c.req.url`. */
function requestTarget(c: AppContext): string {
  const incoming = (c.env as Partial<HttpBindings> | undefined)?.incoming;
  return incoming?.url ?? c.req.url;
}

/** The request c15t gets: sanitized headers, and no query parameters that override the geo headers. */
function forwardable(request: Request, headers: Headers): Request {
  const url = stripOverrideParams(request.url);
  return url === request.url
    ? new Request(request, { headers })
    : new Request(url, {
        method: request.method,
        headers,
        body: request.body,
        signal: request.signal,
        duplex: 'half',
      });
}

function addGuards(app: Hono<AppEnv>): void {
  // No response from this service is cacheable by Cloudflare: /init depends on the visitor's
  // country. c15t's own browser cache lifetime for the manifest and the script is kept.
  app.use('*', async (c: AppContext, next) => {
    await next();
    const { headers, status } = c.res;
    headers.set('Cloudflare-CDN-Cache-Control', NO_STORE);
    headers.set('CDN-Cache-Control', NO_STORE);
    if (status >= 400 || !headers.has('cache-control')) headers.set('Cache-Control', NO_STORE);
  });

  app.use('*', async (c: AppContext, next) => {
    if (!isSafePath(requestTarget(c))) return jsonError('BAD_REQUEST', 'Invalid request path.');
    return next();
  });
}

function addStatusRoutes(app: Hono<AppEnv>, deps: AppDeps, log: Logger): void {
  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.get('/status', async (c) => {
    try {
      const { activeSites } = await deps.readiness();
      return c.json({
        status: 'ok',
        listener: deps.listenerState(),
        activeSites,
        cachedInstances: deps.registry.size,
      });
    } catch (error) {
      log.error('readiness check failed', errorFields(error));
      return c.json(apiError('SERVICE_UNAVAILABLE', 'The database is not reachable.'), 503);
    }
  });
}

/** What one attempt forwards to c15t: the request as received and its sanitized headers. */
interface Forward {
  readonly request: Request;
  readonly headers: Headers;
  readonly trusted: boolean;
}

async function attemptSite(
  deps: AppDeps,
  siteKey: string,
  { request, headers, trusted }: Forward,
): Promise<SiteLookup<Attempt>> {
  return deps.registry.use(siteKey, async (handle): Promise<Attempt> => {
    if (!requestHostAllowed(headers, trusted, handle.site.domains)) return { kind: 'denied' };
    try {
      const response = await handle.instance.handler(forwardable(request, headers));
      if (!(await isDatabaseFailure(response))) return { kind: 'response', response };
    } catch (error) {
      if (!isFailoverError(error)) throw error;
    }
    return { kind: 'database-failure', outcome: deps.registry.evict(siteKey, handle) };
  });
}

function unavailable(): Response {
  const response = jsonError(
    'SERVICE_UNAVAILABLE',
    'Consent storage is temporarily unavailable. Please retry.',
  );
  response.headers.set('Retry-After', '1');
  return response;
}

function createSiteServer(
  deps: AppDeps,
  log: Logger,
): (c: AppContext, siteKey: string) => Promise<Response> {
  return async (c, siteKey) => {
    const { headers, trusted } = sanitizeHeaders(c.req.raw.headers, {
      peer: peerAddress(c),
      trustedProxies: deps.trustedProxies,
    });
    const method = c.req.method;
    const forward: Forward = { request: c.req.raw, headers, trusted };
    let result = await attemptSite(deps, siteKey, forward);
    // A write may have committed before the connection broke: only reads are retried, once,
    // on the instance that replaced the failed one.
    if (
      (method === 'GET' || method === 'HEAD') &&
      result.found &&
      result.value.kind === 'database-failure' &&
      result.value.outcome !== 'throttled'
    ) {
      result = await attemptSite(deps, siteKey, forward);
    }
    if (!result.found || result.value.kind === 'denied') {
      return jsonError('NOT_FOUND', 'Not found.');
    }
    if (result.value.kind === 'response') return asJsonError(result.value.response);
    log.warn('database failure behind a c15t instance', {
      siteKey,
      method,
      outcome: result.value.outcome,
    });
    return unavailable();
  };
}

function addSiteRoutes(app: Hono<AppEnv>, deps: AppDeps, log: Logger): void {
  app.use(
    '/s/*',
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c: AppContext) =>
        c.json(apiError('BAD_REQUEST', 'Request body is too large.'), 413),
    }),
  );

  const serveSite = createSiteServer(deps, log);

  app.on(METHODS, '/s/:siteKey/*', async (c) => {
    const siteKey = siteKeyFromPath(requestTarget(c));
    if (siteKey === undefined) return jsonError('NOT_FOUND', 'Not found.');
    try {
      return await serveSite(c, siteKey);
    } catch (error) {
      if (error instanceof SiteConfigError) {
        log.error('site configuration rejected', { siteKey, message: error.message });
        return jsonError('INTERNAL_ERROR', 'Site configuration is invalid.');
      }
      if (isFailoverError(error)) {
        log.warn('site registry unreachable', { siteKey, ...errorFields(error) });
        return unavailable();
      }
      throw error;
    }
  });
}

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const log = deps.logger ?? silentLogger;
  const app = new Hono<AppEnv>();

  addGuards(app);
  addStatusRoutes(app, deps, log);
  addSiteRoutes(app, deps, log);

  app.notFound(() => jsonError('NOT_FOUND', 'Not found.'));

  app.onError((error) => {
    log.error('unhandled error', errorFields(error));
    return jsonError('INTERNAL_ERROR', 'Internal server error.');
  });

  return app;
}
