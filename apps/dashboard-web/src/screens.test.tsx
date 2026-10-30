// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { resolveRange } from './lib/range';
import {
  admin,
  auditEntry,
  blog,
  consent,
  plainUser,
  shop,
  shopDetail,
  stats,
  userSummary,
} from './test/fixtures';
import { apiError, json, mockFetch, renderApp, route } from './test/harness';

const asUser = route('GET /api/me', json(plainUser));
const asAdmin = route('GET /api/me', json(admin));
const siteRoutes = [
  route('GET /api/sites/shop', json(shopDetail)),
  route('GET /api/sites/shop/stats', json(stats)),
];

test('sites list: cards link to each site', async () => {
  mockFetch(asUser, route('GET /api/sites', json({ items: [shop, blog] })));
  renderApp('/sites');
  const link = await screen.findByRole('link', { name: 'Shop' });
  expect(link).toHaveAttribute('href', '/sites/shop');
  expect(screen.getByRole('link', { name: 'Blog' })).toHaveAttribute('href', '/sites/blog');
  expect(screen.getByText('shop.example.com, www.shop.example.com')).toBeInTheDocument();
});

test('sites list: empty, loading and error states', async () => {
  let answer: () => Response = () => json({ items: [] });
  mockFetch(
    asUser,
    route('GET /api/sites', () => answer()),
  );
  const { unmount } = renderApp('/sites');
  expect(await screen.findByText('No sites yet')).toBeInTheDocument();
  expect(screen.getByText(/Ask an administrator for access/)).toBeInTheDocument();
  unmount();

  answer = () => apiError(404, 'NOT_FOUND');
  renderApp('/sites');
  expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
});

test('an admin with no sites is pointed at site management', async () => {
  mockFetch(asAdmin, route('GET /api/sites', json({ items: [] })));
  renderApp('/sites');
  expect(await screen.findAllByRole('link', { name: 'Manage sites' })).not.toHaveLength(0);
});

test('a site the user cannot see is "not found", whatever the reason', async () => {
  mockFetch(asUser, route('GET /api/sites/secret', apiError(404, 'NOT_FOUND')));
  renderApp('/sites/secret');
  expect(await screen.findByText('Site not found')).toBeInTheDocument();
});

test('site overview: tiles, charts with a table twin, and a range filter that refetches', async () => {
  const { calls } = mockFetch(asUser, ...siteRoutes);
  renderApp('/sites/shop');
  expect(await screen.findByRole('heading', { name: 'Shop' })).toBeInTheDocument();
  expect(await screen.findByText('1,280')).toBeInTheDocument();
  expect(screen.getByText('640')).toBeInTheDocument();
  // 1,200 granted of 2,560 decisions
  expect(screen.getByText('Overall opt-in rate')).toBeInTheDocument();
  expect(screen.getByText(/Busiest day: 5 Mar 2026 with 880/)).toBeInTheDocument();
  expect(document.querySelector('.recharts-wrapper')).not.toBeNull();

  // The table is the accessible twin of each chart and carries every value.
  const user = userEvent.setup();
  const volumeView = screen.getByRole('group', { name: 'Consent volume view' });
  await user.click(within(volumeView).getByRole('button', { name: 'table' }));
  const table = await screen.findByRole('table', { name: 'Consents per day' });
  expect(within(table).getAllByRole('row')).toHaveLength(4);
  expect(within(table).getByText('880')).toBeInTheDocument();

  const purposeView = screen.getByRole('group', { name: 'Opt-in rate by category view' });
  await user.click(within(purposeView).getByRole('button', { name: 'table' }));
  const purposes = await screen.findByRole('table', { name: 'Opt-in rate by category' });
  expect(within(purposes).getByText('70.3%')).toBeInTheDocument();

  const statsCalls = () => calls.filter((call) => call.url.pathname === '/api/sites/shop/stats');
  expect(statsCalls()[0]?.url.searchParams.get('from')).toBe(resolveRange({}).from);
  await user.selectOptions(screen.getByLabelText('Period'), '7d');
  await waitFor(() => expect(statsCalls()).toHaveLength(2));
  expect(statsCalls()[1]?.url.searchParams.get('from')).toBe(resolveRange({ range: '7d' }).from);
});

test('site overview: an empty period and a failing service', async () => {
  const empty = {
    ...stats,
    totals: { consents: 0, subjects: 0 },
    volume: [],
    purposes: [],
    jurisdictions: [],
  };
  let answer: () => Response = () => json(empty);
  mockFetch(
    asUser,
    route('GET /api/sites/shop', json(shopDetail)),
    route('GET /api/sites/shop/stats', () => answer()),
  );
  const { unmount } = renderApp('/sites/shop');
  expect(await screen.findByText('No consents in this period.')).toBeInTheDocument();
  expect(screen.getByText('No decisions in this period')).toBeInTheDocument();
  unmount();

  answer = () => apiError(503, 'SERVICE_UNAVAILABLE');
  renderApp('/sites/shop?range=90d');
  expect(
    await screen.findByRole('button', { name: 'Try again' }, { timeout: 8000 }),
  ).toBeInTheDocument();
}, 15000);

test('consent records: search, details, cursor pagination and the CSV link', async () => {
  const { calls } = mockFetch(
    asUser,
    route('GET /api/sites/shop', json(shopDetail)),
    route('GET /api/sites/shop/consents', (request) => {
      const cursor = request.url.searchParams.get('cursor');
      return cursor === null
        ? json({ items: [consent('a1'), consent('a2')], nextCursor: 'cur-1' })
        : json({ items: [consent('b1', { externalId: 'user-77' })], nextCursor: null });
    }),
  );
  renderApp('/sites/shop/consents?from=2026-03-01&to=2026-03-31');
  const user = userEvent.setup();
  expect(await screen.findByText('sub_a1')).toBeInTheDocument();
  expect(screen.getByText('sub_a2')).toBeInTheDocument();
  expect(screen.getByText('2 records loaded')).toBeInTheDocument();

  const csv = screen.getByRole('link', { name: /Export CSV/ });
  expect(csv).toHaveAttribute('href', '/api/sites/shop/consents.csv?from=2026-03-01&to=2026-03-31');
  expect(csv).toHaveAttribute('download');

  await user.click(screen.getByRole('button', { name: 'Load more' }));
  expect(await screen.findByText('sub_b1')).toBeInTheDocument();
  expect(screen.getByText('user-77')).toBeInTheDocument();
  expect(screen.getByText('3 records loaded, end of list')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  const listCalls = calls.filter((call) => call.url.pathname === '/api/sites/shop/consents');
  expect(listCalls[0]?.url.searchParams.get('from')).toBe('2026-03-01');
  expect(listCalls[1]?.url.searchParams.get('cursor')).toBe('cur-1');

  await user.click(screen.getAllByRole('button', { name: /^Details/ })[0] as HTMLElement);
  const dialog = await screen.findByRole('dialog', { name: 'Consent record' });
  expect(within(dialog).getByText('Mozilla/5.0')).toBeInTheDocument();
  expect(within(dialog).getByText(/measurement/)).toBeInTheDocument();
});

test('consent records: a subject search goes into the query, and "no results" is explained', async () => {
  const { calls } = mockFetch(
    asUser,
    route('GET /api/sites/shop', json(shopDetail)),
    route('GET /api/sites/shop/consents', (request) =>
      request.url.searchParams.has('subject')
        ? json({ items: [], nextCursor: null })
        : json({ items: [consent('a1')], nextCursor: null }),
    ),
  );
  renderApp('/sites/shop/consents');
  const user = userEvent.setup();
  await screen.findByText('sub_a1');
  await user.type(screen.getByLabelText('Subject ID'), 'sub_zzz');
  await user.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByText('No records found')).toBeInTheDocument();
  expect(calls.at(-1)?.url.searchParams.get('subject')).toBe('sub_zzz');

  await user.click(screen.getByRole('button', { name: 'Clear' }));
  expect(await screen.findByText('sub_a1')).toBeInTheDocument();
});

test('consent records: a reversed date range is refused before the request', async () => {
  const { calls } = mockFetch(
    asUser,
    route('GET /api/sites/shop', json(shopDetail)),
    route('GET /api/sites/shop/consents', json({ items: [consent('a1')], nextCursor: null })),
  );
  renderApp('/sites/shop/consents');
  const user = userEvent.setup();
  await screen.findByText('sub_a1');
  const before = calls.length;
  await user.type(screen.getByLabelText('From'), '2026-03-10');
  await user.type(screen.getByLabelText('To (inclusive)'), '2026-03-01');
  await user.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByText(/must not be after/)).toBeInTheDocument();
  expect(calls.length).toBe(before);
});

test('setup: a user reads the snippets but cannot edit', async () => {
  mockFetch(asUser, route('GET /api/sites/shop', json(shopDetail)));
  renderApp('/sites/shop/setup');
  expect(await screen.findByText(/set \$c15t_site shop;/)).toBeInTheDocument();
  expect(screen.getByText(/data-cfasync="false"/)).toBeInTheDocument();
  // The tag declares the categories, and the screen says why and how to change them.
  expect(screen.getByText(/data-categories="measurement,marketing"/)).toBeInTheDocument();
  expect(screen.getByText(/records only/)).toBeInTheDocument();
  expect(screen.getByText(/functionality, measurement, experience, marketing/)).toBeInTheDocument();
  expect(screen.getByText('www.shop.example.com')).toBeInTheDocument();
  expect(screen.getByText('europeOptIn, worldNone')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Edit site' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /^Copy/ }).length).toBeGreaterThanOrEqual(3);
});

test('setup: an admin can edit, with the key fixed', async () => {
  const { calls } = mockFetch(
    asAdmin,
    route('GET /api/sites/shop', json(shopDetail)),
    route('PATCH /api/admin/sites/shop', json(shop)),
  );
  renderApp('/sites/shop/setup');
  const user = userEvent.setup();
  expect(await screen.findByRole('heading', { name: 'Edit site' })).toBeInTheDocument();
  expect(screen.getByLabelText('Site key')).toHaveAttribute('readonly');
  await user.clear(screen.getByLabelText('Name'));
  await user.type(screen.getByLabelText('Name'), 'Shop 2');
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(calls.some((call) => call.method === 'PATCH')).toBe(true));
});

test('account: profile and role', async () => {
  mockFetch(asUser);
  renderApp('/account');
  expect(await screen.findByRole('heading', { name: 'Account' })).toBeInTheDocument();
  expect(screen.getAllByText(plainUser.email).length).toBeGreaterThan(0);
  expect(screen.getByText(plainUser.name)).toBeInTheDocument();
  expect(screen.queryByText('Choose a new password to continue')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Sign out' })).toHaveLength(2);
});

const banned = userSummary({
  id: 'u-b',
  name: 'Bo Banned',
  email: 'bo@example.com',
  banned: true,
  banReason: 'spam',
});

test('admin users: list with states, then ban and unban', async () => {
  const { calls } = mockFetch(
    asAdmin,
    route('GET /api/admin/sites', json({ items: [shop, blog] })),
    route(
      'GET /api/admin/users',
      json({ items: [userSummary({ ...admin, siteKeys: [] }), userSummary(), banned] }),
    ),
    route('POST /api/admin/users/u-user/ban', json(userSummary({ banned: true }))),
    route('POST /api/admin/users/u-b/unban', json(userSummary(banned))),
  );
  renderApp('/admin/users');
  const user = userEvent.setup();
  expect(await screen.findByText('una@example.com')).toBeInTheDocument();
  expect(screen.getByText('Banned')).toBeInTheDocument();
  expect(screen.getByText('spam')).toBeInTheDocument();
  expect(screen.getByText('All sites')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Actions for una@example.com' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Ban user' }));
  const dialog = await screen.findByRole('dialog', { name: 'Ban user' });
  await user.type(within(dialog).getByLabelText('Reason (optional)'), ' abuse ');
  await user.selectOptions(within(dialog).getByLabelText('Duration'), '7 days');
  await user.click(within(dialog).getByRole('button', { name: 'Ban user' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(calls.find((call) => call.url.pathname === '/api/admin/users/u-user/ban')?.body).toEqual({
    reason: 'abuse',
    expiresInSeconds: 604800,
  });

  await user.click(screen.getByRole('button', { name: 'Actions for bo@example.com' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Unban' }));
  const confirm = await screen.findByRole('dialog', { name: 'Unban user?' });
  await user.click(within(confirm).getByRole('button', { name: 'Unban' }));
  await waitFor(() =>
    expect(calls.some((call) => call.url.pathname.endsWith('/unban'))).toBe(true),
  );
});

test('admin users: assign sites sends the complete new set', async () => {
  const { calls } = mockFetch(
    asAdmin,
    route('GET /api/admin/sites', json({ items: [shop, blog] })),
    route('GET /api/admin/users', json({ items: [userSummary()] })),
    route('PUT /api/admin/users/u-user/sites', json(userSummary({ siteKeys: ['shop', 'blog'] }))),
  );
  renderApp('/admin/users');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Actions for una@example.com' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Assign sites' }));
  const dialog = await screen.findByRole('dialog', { name: 'Assign sites' });
  expect(within(dialog).getByRole('checkbox', { name: /Shop/ })).toBeChecked();
  await user.click(within(dialog).getByRole('checkbox', { name: /Blog/ }));
  await user.click(within(dialog).getByRole('button', { name: 'Save assignments' }));
  await waitFor(() =>
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
      siteKeys: ['shop', 'blog'],
    }),
  );
});

test('admin users: editing sends only what changed, and the last-admin rule is shown', async () => {
  const { calls } = mockFetch(
    asAdmin,
    route('GET /api/admin/sites', json({ items: [shop] })),
    route('GET /api/admin/users', json({ items: [userSummary({ ...admin, siteKeys: [] })] })),
    route(
      'PATCH /api/admin/users/u-admin',
      apiError(409, 'LAST_ADMIN', 'At least one active administrator must remain'),
    ),
  );
  renderApp('/admin/users');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: `Actions for ${admin.email}` }));
  await user.click(await screen.findByRole('menuitem', { name: 'Edit name and role' }));
  const dialog = await screen.findByRole('dialog', { name: 'Edit user' });
  await user.selectOptions(within(dialog).getByLabelText('Role'), 'user');
  await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  expect(
    await within(dialog).findByText('At least one active administrator must remain'),
  ).toBeInTheDocument();
  expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ role: 'user' });
});

test('admin audit: entries, details and older pages', async () => {
  const { calls } = mockFetch(
    asAdmin,
    route('GET /api/admin/audit', (request) =>
      request.url.searchParams.get('cursor') === null
        ? json({ items: [auditEntry], nextCursor: 'older' })
        : json({
            items: [
              { ...auditEntry, id: 'a0', action: 'user.ban', targetType: 'user', metadata: {} },
            ],
            nextCursor: null,
          }),
    ),
  );
  renderApp('/admin/audit');
  const user = userEvent.setup();
  expect(await screen.findByText('Site created')).toBeInTheDocument();
  expect(screen.getByText('203.0.113.7')).toBeInTheDocument();
  await user.click(screen.getByText('Show'));
  expect(screen.getByText(/"name": "Shop"/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Load older entries' }));
  expect(await screen.findByText('User banned')).toBeInTheDocument();
  expect(screen.getByText('2 entries loaded, end of log')).toBeInTheDocument();
  expect(calls.at(-1)?.url.searchParams.get('cursor')).toBe('older');
});

test('admin audit: an empty log is explained', async () => {
  mockFetch(asAdmin, route('GET /api/admin/audit', json({ items: [], nextCursor: null })));
  renderApp('/admin/audit');
  expect(await screen.findByText('Nothing logged yet')).toBeInTheDocument();
});

test('admin overview: totals across sites and one row per site', async () => {
  const blogStats = { ...stats, totals: { consents: 20, subjects: 10 }, purposes: [] };
  mockFetch(
    asAdmin,
    route(
      'GET /api/admin/sites',
      json({ items: [shop, { ...blog, status: 'disabled' as const }] }),
    ),
    route('GET /api/sites/shop/stats', json(stats)),
    route('GET /api/sites/blog/stats', json(blogStats)),
  );
  renderApp('/admin/overview');
  expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
  // 1,280 + 20 consents, 640 + 10 subjects
  expect(await screen.findByText('1,300')).toBeInTheDocument();
  expect(screen.getByText('650')).toBeInTheDocument();
  expect(screen.getByText('1 active')).toBeInTheDocument();
  const user = userEvent.setup();
  const view = screen.getByRole('group', { name: 'Consents by site view' });
  await user.click(within(view).getByRole('button', { name: 'table' }));
  const table = await screen.findByRole('table', { name: 'Statistics per site' });
  expect(within(table).getByText('Disabled')).toBeInTheDocument();
  expect(within(table).getByRole('link', { name: 'Blog' })).toHaveAttribute('href', '/sites/blog');
});
