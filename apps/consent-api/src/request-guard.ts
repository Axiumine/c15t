// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import {
  COUNTRY_HEADERS,
  DEFAULT_IP_HEADERS_LIST,
  GPC_HEADERS,
  REGION_HEADERS,
} from '@c15t/schema/geo';
import { ipInCidrs, parseIp, SITE_KEY_PATTERN } from '@consent/shared';

/*
 * Request hardening for the headers c15t trusts (README D1, CLAUDE.md "Network configuration"
 * and "Multi-tenancy"). nginx sets the tenant, the visitor IP and the Host; Cloudflare sets the
 * country and region. Nothing a browser sends may stand in for any of them.
 */

/** The only geo headers a trusted proxy may forward: Cloudflare's own. */
const CLOUDFLARE_GEO_HEADERS = ['cf-ipcountry', 'cf-region-code'] as const;

/**
 * Headers a visitor could use to choose their own jurisdiction or GPC signal. c15t reads them
 * before Cloudflare's, and `sec-gpc` (the browser's own signal) stays. The lists come from the
 * installed c15t so an upgrade that reads a new header is covered without a code change; the
 * literals are a floor in case a future version renames the exports.
 */
export const VISITOR_OVERRIDE_HEADERS: readonly string[] = [
  ...new Set([
    ...COUNTRY_HEADERS,
    ...REGION_HEADERS,
    ...GPC_HEADERS.filter((name) => name !== 'sec-gpc'),
    'x-c15t-country',
    'x-c15t-region',
    'x-c15t-gpc',
    'x-vercel-ip-country',
    'x-vercel-ip-country-region',
    'x-amz-cf-ipcountry',
    'x-country-code',
    'x-country',
    'x-region-code',
  ]),
].filter((name) => !(CLOUDFLARE_GEO_HEADERS as readonly string[]).includes(name));

/**
 * `/init` reads these query parameters before the headers above, and documents them as
 * visitor-controlled (c15t "HTTP endpoints, query parameters and CORS").
 */
export const VISITOR_OVERRIDE_PARAMS: readonly string[] = ['country', 'region', 'gpc'];

const CLIENT_IP_HEADER = 'x-forwarded-for';

/** Every header a proxy may use to carry the client IP. c15t is told to read only `x-forwarded-for`. */
const IP_HEADERS: ReadonlySet<string> = new Set([
  ...DEFAULT_IP_HEADERS_LIST,
  'true-client-ip',
  'x-real-ip',
  'x-client-ip',
  'cf-connecting-ip',
  'cf-connecting-ipv6',
]);

const COUNTRY_CODE = /^(?:[A-Za-z]{2}|T1)$/;
const REGION_CODE = /^[A-Za-z0-9-]{1,8}$/;

export interface SanitizeOptions {
  /** TCP peer address from the socket. `undefined` means unknown, which counts as untrusted. */
  readonly peer: string | undefined;
  readonly trustedProxies: readonly string[];
}

export interface SanitizedHeaders {
  readonly headers: Headers;
  /** The peer is in `CONSENT_API_TRUSTED_PROXIES`. */
  readonly trusted: boolean;
}

function isForwardingHeader(name: string): boolean {
  return (
    name.startsWith('x-forwarded-') ||
    name.startsWith('cf-') ||
    name === 'forwarded' ||
    IP_HEADERS.has(name)
  );
}

/**
 * The client address in an `X-Forwarded-For` chain: the first entry, read right to left, that is
 * not one of our own proxies. A visitor can prepend entries; they cannot change what the proxies
 * append. A malformed entry yields no address at all, rather than a guess.
 */
export function clientAddress(
  forwardedFor: string | null,
  trustedProxies: readonly string[],
): string | undefined {
  if (forwardedFor === null) return undefined;
  const entries = forwardedFor
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry === undefined || parseIp(entry) === null) return undefined;
    if (index === 0 || !ipInCidrs(entry, trustedProxies)) return entry;
  }
  return undefined;
}

/**
 * Returns a copy of the headers that is safe to hand to c15t.
 *
 * - Jurisdiction and GPC override headers are always removed, from every peer.
 * - From an untrusted peer, all forwarding headers (`X-Forwarded-*`, `CF-*`, `Forwarded` and the
 *   IP headers) are removed too.
 * - From a trusted peer, `X-Forwarded-For` is reduced to the single client address, and
 *   Cloudflare's country and region are kept if they look like codes.
 */
export function sanitizeHeaders(source: Headers, options: SanitizeOptions): SanitizedHeaders {
  const headers = new Headers(source);
  const trusted = options.peer !== undefined && ipInCidrs(options.peer, options.trustedProxies);

  for (const name of VISITOR_OVERRIDE_HEADERS) headers.delete(name);

  if (!trusted) {
    for (const name of [...headers.keys()]) {
      if (isForwardingHeader(name)) headers.delete(name);
    }
    return { headers, trusted };
  }

  const client = clientAddress(headers.get(CLIENT_IP_HEADER), options.trustedProxies);
  for (const name of IP_HEADERS) headers.delete(name);
  headers.delete('forwarded');
  if (client !== undefined) headers.set(CLIENT_IP_HEADER, client);

  const country = headers.get('cf-ipcountry');
  if (country !== null && !COUNTRY_CODE.test(country)) headers.delete('cf-ipcountry');
  const region = headers.get('cf-region-code');
  if (region !== null && !REGION_CODE.test(region)) headers.delete('cf-region-code');

  return { headers, trusted };
}

/** The request URL without the query parameters that let a visitor choose their jurisdiction. */
export function stripOverrideParams(url: string): string {
  const parsed = new URL(url);
  if (!VISITOR_OVERRIDE_PARAMS.some((name) => parsed.searchParams.has(name))) return url;
  for (const name of VISITOR_OVERRIDE_PARAMS) parsed.searchParams.delete(name);
  return parsed.toString();
}

/*
 * Paths. The URL parser resolves `..` and decodes some escapes, so the check has to run on the
 * raw request target, before routing. nginx normalises paths already; this is the second wall.
 */

const UNSAFE_PATH = /\.\.|%2e|%2f|%5c|%25|%[01][0-9a-f]|%7f|\\|(?:^|\/)\.(?:\/|$)/i;

function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** The raw request target without query or fragment. Handles origin-form and absolute-form. */
export function rawPathname(target: string): string {
  let path = target;
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(path);
  if (scheme !== null) path = path.slice(scheme[0].length);
  const end = path.search(/[?#]/);
  return end === -1 ? path : path.slice(0, end);
}

export function isSafePath(target: string): boolean {
  const path = rawPathname(target);
  return path.startsWith('/') && !UNSAFE_PATH.test(path) && !hasControlCharacter(path);
}

const SITE_PATH = new RegExp(`^/s/(${SITE_KEY_PATTERN.source.slice(1, -1)})(?=/|$)`);

/** The `siteKey` of `/s/<siteKey>/...`, read from the raw path so it matches what c15t will see. */
export function siteKeyFromPath(target: string): string | undefined {
  return SITE_PATH.exec(rawPathname(target))?.[1];
}

/*
 * Host. Defense in depth behind the nginx vhost mapping (README D1): a request that arrives
 * through a vhost must name one of the site's domains, so a wrong `set $c15t_site` cannot serve
 * site A's consents under site B's hostname.
 */

interface HostParts {
  readonly hostname: string;
  readonly port: string | undefined;
}

function splitHost(value: string): HostParts | null {
  const text = value.trim().toLowerCase();
  if (!/^[a-z0-9.\-:[\]]+$/.test(text)) return null;
  try {
    const url = new URL(`http://${text}`);
    return { hostname: url.hostname, port: url.port === '' ? undefined : url.port };
  } catch {
    return null;
  }
}

function isDirectHost(hostname: string): boolean {
  const bare = hostname.replace(/^\[(.*)\]$/, '$1');
  return parseIp(bare) !== null || hostname === 'localhost' || hostname.endsWith('.localhost');
}

function hostMatches(value: string, domains: readonly string[]): boolean {
  const host = splitHost(value);
  if (host === null) return false;
  // Server code calling consent-api by IP or localhost never passes through a vhost: no site
  // hostname exists to verify.
  if (isDirectHost(host.hostname)) return true;
  return domains.some((domain) => {
    const allowed = splitHost(domain);
    // Like c15t's trusted origins: a domain without a port allows any port.
    return (
      allowed !== null &&
      allowed.hostname === host.hostname &&
      (allowed.port === undefined || allowed.port === host.port)
    );
  });
}

/**
 * `X-Forwarded-Host` from a trusted proxy, else `Host`. Every value in a list must match.
 * No Host header at all (tests, HTTP/1.0) leaves nothing to verify.
 */
export function requestHostAllowed(
  headers: Headers,
  trusted: boolean,
  domains: readonly string[],
): boolean {
  const raw = (trusted ? headers.get('x-forwarded-host') : null) ?? headers.get('host');
  if (raw === null) return true;
  return raw.split(',').every((part) => hostMatches(part, domains));
}
