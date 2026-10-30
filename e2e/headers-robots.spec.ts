// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { expect, test } from './support/fixtures.js';
import { dashboardCsp, resetHygiene } from './support/instrument.js';

/*
 * Scenario 3: the built dashboard (`vite preview`, no nginx) is private and strict.
 * - noindex everywhere: robots meta tag, robots.txt, X-Robots-Tag on every API answer;
 * - no inline script and no inline handler in the shipped HTML;
 * - the CSP that nginx sends (read from infra/nginx/dashboard-headers.conf) is strict, and the
 *   app runs under it without a single violation. Every other scenario also runs under it: the
 *   `hygiene` fixture fails any test that broke the policy on a screen it visited.
 */

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(';')
      .map((part) => part.trim().split(/\s+/))
      .filter((tokens) => tokens[0] !== '' && tokens[0] !== undefined)
      .map(([name, ...values]) => [name as string, values]),
  );
}

test.describe('robots and indexing', () => {
  test('robots.txt disallows everything', async ({ request }) => {
    const response = await request.get('/robots.txt');
    expect(response.status()).toBe(200);
    const lines = (await response.text()).split('\n').map((line) => line.trim());
    expect(lines).toContain('User-agent: *');
    expect(lines).toContain('Disallow: /');
    expect(lines.filter((line) => /^allow:/i.test(line))).toEqual([]);
    expect(lines.filter((line) => /^sitemap:/i.test(line))).toEqual([]);
  });

  test('the HTML carries the robots meta tag and no sitemap or social tags', async ({
    request,
  }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toMatch(/<meta\s+name="robots"\s+content="noindex, nofollow"\s*\/?>/);
    expect(html).not.toMatch(/property="og:|name="twitter:|rel="sitemap"|rel="canonical"/);
  });

  test('every API answer, errors included, says noindex and no-store', async ({ request, rt }) => {
    const answers = [
      await request.get('/api/health'),
      await request.get('/api/me'),
      await request.get('/api/admin/users'),
      await request.get('/api/does-not-exist'),
      await request.get('/api/auth/nope'),
      // A write without the trusted Origin is refused, and the refusal carries the headers too.
      await request.post('/api/auth/sign-in/email', {
        data: { email: `${rt.runId}@e2e.example.com`, password: 'x' },
        headers: { Origin: 'https://evil.example' },
      }),
    ];
    expect(answers.map((answer) => answer.status())).toEqual([200, 401, 401, 404, 404, 403]);
    for (const answer of answers) {
      const headers = answer.headers();
      expect(headers['x-robots-tag'], answer.url()).toBe('noindex, nofollow');
      expect(headers['cache-control'], answer.url()).toBe('no-store');
      expect(headers['x-content-type-options'], answer.url()).toBe('nosniff');
    }
  });
});

test.describe('content security policy', () => {
  test('the policy nginx ships is strict', () => {
    const policy = directives(dashboardCsp());
    expect(policy.get('default-src')).toEqual(["'self'"]);
    // script-src is not set, so default-src governs scripts: same origin only.
    expect(policy.has('script-src')).toBe(false);
    for (const [name, values] of policy) {
      if (name === 'style-src') continue; // inline styles (charts, Radix) are allowed, scripts are not
      expect(values, name).not.toContain("'unsafe-inline'");
      expect(values, name).not.toContain("'unsafe-eval'");
      expect(values, name).not.toContain('*');
    }
    expect(policy.get('frame-ancestors')).toEqual(["'none'"]);
    expect(policy.get('base-uri')).toEqual(["'none'"]);
    expect(policy.get('form-action')).toEqual(["'self'"]);
  });

  test('the shipped HTML has no inline script and no inline event handler', async ({ request }) => {
    const html = await (await request.get('/')).text();
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script[^>]*>/gi)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, attributes, body] of scripts) {
      expect(attributes, 'script without src').toMatch(/\bsrc="\/assets\/[^"]+\.js"/);
      expect((body ?? '').trim()).toBe('');
    }
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toMatch(/javascript:/i);
  });

  test('login and the not-found screen run under the policy without violations', async ({
    page,
    hygiene,
  }) => {
    const response = await page.goto('/login');
    expect(response?.headers()['content-security-policy']).toBe(dashboardCsp());
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

    // Client-side routing falls back to index.html for unknown paths, as nginx does.
    await page.goto('/no/such/screen');
    await expect(page.getByText('Page not found')).toBeVisible();
    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeVisible();

    expect(hygiene.documents).toBeGreaterThanOrEqual(3);
    expect(await page.evaluate(() => document.scripts.length)).toBeGreaterThan(0);
    expect(
      await page.evaluate(() => [...document.scripts].filter((script) => !script.src).length),
    ).toBe(0);
  });

  test('the watcher does catch a violation (negative control)', async ({ page, hygiene, rt }) => {
    await page.route(`${rt.dashboardOrigin}/__csp-probe`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        headers: { 'content-security-policy': dashboardCsp() },
        body: '<!doctype html><title>probe</title><script>window.__ran = true</script>',
      }),
    );
    await page.goto('/__csp-probe');
    // The browser refused to run it ...
    expect(await page.evaluate(() => 'ran' in window || '__ran' in window)).toBe(false);
    // ... and the watcher saw both the blocked script and the inline element.
    await expect.poll(() => hygiene.csp.length).toBeGreaterThan(0);
    expect(hygiene.csp.join('\n')).toMatch(/script-src/);
    await expect.poll(() => hygiene.inlineScripts.length).toBe(1);
    resetHygiene(hygiene); // expected here; any other test would fail on it
  });
});
