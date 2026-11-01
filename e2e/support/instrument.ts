// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { REPO_ROOT, type Runtime } from './runtime.js';

/*
 * What the dashboard must satisfy on every screen a test visits (README D10, "Security notes"):
 * the strict Content-Security-Policy from infra/nginx/dashboard-headers.conf is enforced, so a
 * blocked script, style or connection is a violation; no inline <script> exists; and nothing
 * throws an uncaught exception. `vite preview` sends no CSP, so the policy is read from the nginx
 * snippet (the file nginx ships) and applied to every document response of the dashboard origin.
 */

const HEADERS_FILE = resolve(REPO_ROOT, 'infra/nginx/dashboard-headers.conf');

/** The `Content-Security-Policy` value nginx sends, read from the snippet itself. */
export function dashboardCsp(): string {
  const match = /add_header\s+Content-Security-Policy\s+"([^"]+)"/.exec(
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- a fixed file of this repository
    readFileSync(HEADERS_FILE, 'utf8'),
  );
  if (match?.[1] === undefined)
    throw new Error('No Content-Security-Policy in dashboard-headers.conf');
  return match[1];
}

export interface Hygiene {
  /** `securitypolicyviolation` events and console errors that name the policy. */
  readonly csp: string[];
  /** `<script>` elements without a `src`, as the DOM received them. */
  readonly inlineScripts: string[];
  /** Uncaught exceptions in any page of the context. */
  readonly pageErrors: string[];
  /** Number of document responses the policy was applied to. */
  documents: number;
}

export function emptyHygiene(): Hygiene {
  return { csp: [], inlineScripts: [], pageErrors: [], documents: 0 };
}

export function hygieneProblems(hygiene: Hygiene): string[] {
  return [
    ...hygiene.csp.map((entry) => `CSP violation: ${entry}`),
    ...hygiene.inlineScripts.map((entry) => `inline script: ${entry}`),
    ...hygiene.pageErrors.map((entry) => `uncaught exception: ${entry}`),
  ];
}

export function resetHygiene(hygiene: Hygiene): void {
  hygiene.csp.length = 0;
  hygiene.inlineScripts.length = 0;
  hygiene.pageErrors.length = 0;
}

/** Runs in every document at creation time, before any page script. */
function watchDocument(): void {
  type Report = (kind: string, detail: string) => void;
  const report = (window as unknown as { __e2eReport: Report }).__e2eReport;
  document.addEventListener('securitypolicyviolation', (event) => {
    report(
      'csp',
      `${event.violatedDirective} blocked=${event.blockedURI} source=${event.sourceFile}`,
    );
  });
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLScriptElement && !node.hasAttribute('src')) {
          report('inline-script', node.textContent.slice(0, 80));
        }
      }
    }
  }).observe(document, { childList: true, subtree: true });
}

function watchPage(page: Page, hygiene: Hygiene): void {
  page.on('pageerror', (error) => hygiene.pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && /content security policy/i.test(message.text())) {
      hygiene.csp.push(`console: ${message.text().slice(0, 200)}`);
    }
  });
}

/**
 * Applies the dashboard CSP to the document responses of `rt.dashboardOrigin` and starts
 * collecting violations. Call before the first navigation of the context.
 */
export async function instrumentContext(context: BrowserContext, rt: Runtime): Promise<Hygiene> {
  const hygiene = emptyHygiene();
  const csp = dashboardCsp();
  await context.exposeBinding('__e2eReport', (_source, kind: string, detail: string) => {
    if (kind === 'csp') hygiene.csp.push(detail);
    else if (kind === 'inline-script') hygiene.inlineScripts.push(detail);
  });
  await context.addInitScript(watchDocument);
  await context.route(`${rt.dashboardOrigin}/**`, async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    hygiene.documents += 1;
    return route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': csp },
    });
  });
  for (const page of context.pages()) watchPage(page, hygiene);
  context.on('page', (page) => watchPage(page, hygiene));
  return hygiene;
}
