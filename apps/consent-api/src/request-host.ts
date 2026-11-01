// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { parseIp } from '@consent/shared';

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
