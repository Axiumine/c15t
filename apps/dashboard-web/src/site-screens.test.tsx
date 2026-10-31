// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { expect, test } from 'vitest';
import { createQueryClient } from './api';
import { formatDateTime } from './lib/format';
import { PurposeBadges } from './screens/site/consent-detail';
import { SetupScreen } from './screens/site/setup';
import { admin, consent, plainUser, shop, shopDetail, stats } from './test/fixtures';
import { apiError, json, mockFetch, renderApp, route } from './test/harness';

const asUser = route('GET /api/me', json(plainUser));
const asAdmin = route('GET /api/me', json(admin));

/** Answers `failures` times with a 500, then with `good`. */
function flaky(failures: number, good: Response) {
  let left = failures;
  return () => {
    if (left > 0) {
      left -= 1;
      return apiError(500, 'INTERNAL_ERROR', 'select * from secret failed');
    }
    return good.clone();
  };
}

function renderScreen(ui: ReactNode) {
  const queryClient = createQueryClient({
    onUnauthorized: () => undefined,
    onPasswordChangeRequired: () => undefined,
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

test('sites list: an admin with no sites gets the first-site prompt with a link to site management', async () => {
  mockFetch(asAdmin, route('GET /api/sites', json({ items: [] })));
  renderApp('/sites');
  const prompt = await screen.findByText('Add the first website to start collecting consent.');
  const link = within(prompt.parentElement as HTMLElement).getByRole('link', {
    name: 'Manage sites',
  });
  expect(link).toHaveAttribute('href', '/admin/sites');
  expect(screen.getByText('Every website on the platform.')).toBeInTheDocument();
  expect(screen.queryByText(/Ask an administrator for access/)).not.toBeInTheDocument();
});

test('sites list: a user with no sites is told to ask an administrator and gets no site-management link', async () => {
  mockFetch(asUser, route('GET /api/sites', json({ items: [] })));
  renderApp('/sites');
  const prompt = await screen.findByText(/Ask an administrator for access/);
  expect(within(prompt.parentElement as HTMLElement).queryByRole('link')).not.toBeInTheDocument();
  expect(screen.getByText('The websites assigned to you.')).toBeInTheDocument();
});

test('sites list: a failed load can be retried', async () => {
  const { calls } = mockFetch(asUser, route('GET /api/sites', flaky(1, json({ items: [shop] }))));
  renderApp('/sites');
  const user = userEvent.setup();
  expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
  expect(screen.queryByText(/secret/)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('link', { name: 'Shop' })).toBeInTheDocument();
  expect(calls.filter((call) => call.url.pathname === '/api/sites')).toHaveLength(2);
});

test('site layout: a server error is not "not found", and can be retried', async () => {
  mockFetch(asUser, route('GET /api/sites/shop', flaky(1, json(shopDetail))));
  renderApp('/sites/shop/setup');
  const user = userEvent.setup();
  expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
  expect(screen.queryByText('Site not found')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('heading', { name: 'Shop' })).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: 'Site sections' })).toBeInTheDocument();
});

test('site layout: a disabled site says so, and an active one does not', async () => {
  mockFetch(asUser, route('GET /api/sites/shop', json({ ...shopDetail, status: 'disabled' })));
  const { unmount } = renderApp('/sites/shop/setup');
  expect(await screen.findByText(/This site is disabled/)).toBeInTheDocument();
  expect(screen.getByText(/Its consent records are kept/)).toBeInTheDocument();
  unmount();

  mockFetch(asUser, route('GET /api/sites/shop', json(shopDetail)));
  renderApp('/sites/shop/setup');
  await screen.findByRole('heading', { name: 'Shop' });
  expect(screen.queryByText(/This site is disabled/)).not.toBeInTheDocument();
});

test('site overview: a failed statistics load can be retried', async () => {
  const { calls } = mockFetch(
    asUser,
    route('GET /api/sites/shop', json(shopDetail)),
    route('GET /api/sites/shop/stats', flaky(1, json(stats))),
  );
  renderApp('/sites/shop');
  const user = userEvent.setup();
  expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('group', { name: 'Consent volume view' })).toBeInTheDocument();
  expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  expect(calls.filter((call) => call.url.pathname === '/api/sites/shop/stats')).toHaveLength(2);
});

test('setup screen: a placeholder while loading, then a retryable error, then the snippets', async () => {
  let release!: (response: Response) => void;
  const firstAnswer = new Promise<Response>((resolve) => {
    release = resolve;
  });
  let first = true;
  mockFetch(
    asUser,
    route('GET /api/sites/shop', () => {
      if (!first) return json(shopDetail);
      first = false;
      return firstAnswer;
    }),
  );
  renderScreen(<SetupScreen siteKey="shop" />);
  expect(screen.getByText('Loading setup…')).toBeInTheDocument();

  release(apiError(500, 'INTERNAL_ERROR'));
  expect(await screen.findByText('Something went wrong')).toBeInTheDocument();

  await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText(/set \$c15t_site shop;/)).toBeInTheDocument();
  expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
});

test('consent records: missing values show a dash, and an expiry is formatted', async () => {
  const validUntil = '2027-03-05T12:00:00.000Z';
  mockFetch(
    asUser,
    route('GET /api/sites/shop', json(shopDetail)),
    route(
      'GET /api/sites/shop/consents',
      json({
        items: [consent('a1', { jurisdiction: null, countryCode: null, purposes: {}, validUntil })],
        nextCursor: null,
      }),
    ),
  );
  renderApp('/sites/shop/consents');
  const user = userEvent.setup();
  const row = (await screen.findByText('sub_a1')).closest('tr') as HTMLElement;
  const cells = within(row).getAllByRole('cell');
  // Decision, jurisdiction and country are all empty.
  expect(cells.slice(2, 5).map((cell) => cell.textContent)).toEqual(['–', '–', '–']);

  await user.click(within(row).getByRole('button', { name: /^Details/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Consent record' });
  const detailOf = (label: string) =>
    within(dialog).getByText(label).nextElementSibling?.textContent;
  expect(detailOf('Valid until')).toBe(formatDateTime(validUntil));
  expect(detailOf('Jurisdiction')).toBe('–');
  expect(detailOf('Country')).toBe('–');
});

test('consent records: the detail dialog closes again', async () => {
  mockFetch(
    asUser,
    route('GET /api/sites/shop', json(shopDetail)),
    route('GET /api/sites/shop/consents', json({ items: [consent('a1')], nextCursor: null })),
  );
  renderApp('/sites/shop/consents');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /^Details/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Consent record' });
  expect(within(dialog).getByText('Mozilla/5.0')).toBeInTheDocument();

  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

  // And it opens again for another record.
  await user.click(screen.getByRole('button', { name: /^Details/ }));
  expect(await screen.findByRole('dialog', { name: 'Consent record' })).toBeInTheDocument();
});

test('consent records: a failed first load can be retried', async () => {
  mockFetch(
    asUser,
    route('GET /api/sites/shop', json(shopDetail)),
    route(
      'GET /api/sites/shop/consents',
      flaky(1, json({ items: [consent('a1')], nextCursor: null })),
    ),
  );
  renderApp('/sites/shop/consents');
  const user = userEvent.setup();
  expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
  expect(screen.queryByText('No records found')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('sub_a1')).toBeInTheDocument();
});

test('consent records: a failed next page keeps the loaded rows and retries just that page', async () => {
  let failNext = true;
  const { calls } = mockFetch(
    asUser,
    route('GET /api/sites/shop', json(shopDetail)),
    route('GET /api/sites/shop/consents', (request) => {
      if (request.url.searchParams.get('cursor') === null) {
        return json({ items: [consent('a1')], nextCursor: 'cur-1' });
      }
      if (failNext) {
        failNext = false;
        return apiError(500, 'INTERNAL_ERROR');
      }
      return json({ items: [consent('b1')], nextCursor: null });
    }),
  );
  renderApp('/sites/shop/consents');
  const user = userEvent.setup();
  await screen.findByText('sub_a1');
  await user.click(screen.getByRole('button', { name: 'Load more' }));

  expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
  expect(screen.getByText('sub_a1')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('sub_b1')).toBeInTheDocument();
  expect(screen.getByText('sub_a1')).toBeInTheDocument();
  expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  const pages = calls.filter((call) => call.url.pathname === '/api/sites/shop/consents');
  expect(pages.map((call) => call.url.searchParams.get('cursor'))).toEqual([
    null,
    'cur-1',
    'cur-1',
  ]);
});

test('a decision with no purposes shows a dash instead of an empty list', () => {
  render(<PurposeBadges purposes={{}} />);
  expect(screen.getByText('–')).toBeInTheDocument();
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
});
