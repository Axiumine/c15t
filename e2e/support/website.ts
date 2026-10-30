// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { randomBytes } from 'node:crypto';

/*
 * The test "website": one static page, served by the nginx test container for both site
 * hostnames. It carries the banner tag exactly as the dashboard's Setup screen gives it
 * (`setup.scriptTag` of `GET /api/sites/:siteKey`, README "Adding a website", step 4), so the page
 * is only as good as what an operator would paste.
 */
export function sitePage(scriptTag: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>E2E test website</title>
  </head>
  <body>
    <main>
      <h1>E2E test website</h1>
      <p>A page with the c15t banner, served through nginx.</p>
    </main>
    ${scriptTag}
  </body>
</html>
`;
}

/** A client-generated subject id in the format c15t validates (`sub_` plus base58). */
export function subjectId(): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const bytes = randomBytes(24);
  return `sub_${Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')}`;
}

/** A visitor address in TEST-NET-3 that nginx's `real_ip` restores from `CF-Connecting-IP`. */
export function visitorIp(): string {
  return `203.0.113.${1 + (randomBytes(1).readUInt8(0) % 253)}`;
}

/** c15t masks the last octet of a stored IPv4 address. */
export function maskedIp(ip: string): string {
  return `${ip.split('.').slice(0, 3).join('.')}.0`;
}

export interface ConsentBody {
  readonly domain: string;
  readonly subject: string;
  readonly preferences: Record<string, boolean>;
  /**
   * From `/init`: `policyResolution.policyId` and `policyResolution.fingerprints.policy`. Without
   * them the save carries no asserted country: c15t stores the decision with the given model.
   */
  readonly policy?: { readonly policyId: string; readonly fingerprint: string };
}

/** The part of `/init` that a consent save has to echo back. */
export function policyOf(init: unknown): { policyId: string; fingerprint: string } {
  const resolution = (
    init as { policyResolution?: { policyId?: string; fingerprints?: { policy?: string } } }
  ).policyResolution;
  const policyId = resolution?.policyId;
  const fingerprint = resolution?.fingerprints?.policy;
  if (policyId === undefined || fingerprint === undefined) {
    throw new Error('/init did not resolve a policy');
  }
  return { policyId, fingerprint };
}

/** What the banner posts to `/subjects`. */
export function consentBody({ domain, subject, preferences, policy }: ConsentBody) {
  return {
    type: 'cookie_banner',
    domain,
    subjectId: subject,
    givenAt: Date.now(),
    consentAction: 'custom',
    model: 'opt-in',
    uiSource: 'banner',
    preferences,
    ...(policy === undefined ? {} : { country: 'DE', language: 'en', ...policy }),
  };
}
