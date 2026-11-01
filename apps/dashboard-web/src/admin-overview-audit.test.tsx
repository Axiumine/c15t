// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { resolveRange } from './lib/range';
import { admin, auditEntry, blog, shop, stats } from './test/fixtures';
import { apiError, json, mockFetch, renderApp, route } from './test/harness';

// These flows render a lot (charts, tables, portals): never depend on the 1 s default.
configure({ asyncUtilTimeout: 8000 });
vi.setConfig({ testTimeout: 30_000 });

const asAdmin = route('GET /api/me', json(admin));
const blogStats = { ...stats, totals: { consents: 20, subjects: 10 } };
const statsCalls = (calls: { url: URL }[], siteKey: string) =>
  calls.filter((call) => call.url.pathname === `/api/sites/${siteKey}/stats`);

async function openTable(user: ReturnType<typeof userEvent.setup>) {
  const view = await screen.findByRole('group', { name: 'Consents by site view' });
  await user.click(within(view).getByRole('button', { name: 'table' }));
  return screen.findByRole('table', { name: 'Statistics per site' });
}

test('overview: changing the period updates the URL and loads every site for the new range', async () => {
  const { calls } = mockFetch(
    asAdmin,
    route('GET /api/admin/sites', json({ items: [shop, blog] })),
    route('GET /api/sites/shop/stats', json(stats)),
    route('GET /api/sites/blog/stats', json(blogStats)),
  );
  const app = renderApp('/admin/overview');
  const user = userEvent.setup();
  expect(await screen.findByText('1,300')).toBeInTheDocument();
  expect(app.router.state.location.search).toEqual({});

  await user.selectOptions(screen.getByLabelText('Period'), '7d');
  await waitFor(() => expect(app.router.state.location.search).toEqual({ range: '7d' }));
  const from = resolveRange({ range: '7d' }).from;
  await waitFor(() => {
    expect(statsCalls(calls, 'shop').at(-1)?.url.searchParams.get('from')).toBe(from);
    expect(statsCalls(calls, 'blog').at(-1)?.url.searchParams.get('from')).toBe(from);
  });
});

test('overview: a site whose statistics fail is marked, the others still count, and retry reloads', async () => {
  let blogFails = true;
  const { calls } = mockFetch(
    asAdmin,
    route('GET /api/admin/sites', json({ items: [shop, blog] })),
    route('GET /api/sites/shop/stats', json(stats)),
    route('GET /api/sites/blog/stats', () =>
      blogFails ? apiError(500, 'INTERNAL_ERROR') : json(blogStats),
    ),
  );
  renderApp('/admin/overview');
  const user = userEvent.setup();
  expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
  // Only the site that answered is counted.
  expect(screen.getByText('1,280')).toBeInTheDocument();
  expect(screen.queryByText('1,300')).not.toBeInTheDocument();
  const table = await openTable(user);
  expect(
    within(
      within(table).getByRole('link', { name: 'Blog' }).closest('tr') as HTMLElement,
    ).getAllByText('Unavailable'),
  ).toHaveLength(2);
  expect(within(table).queryByText('…')).not.toBeInTheDocument();

  blogFails = false;
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('1,300')).toBeInTheDocument();
  expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  expect(statsCalls(calls, 'blog')).toHaveLength(2);
  // Retrying reloads every site's statistics, not only the failed one.
  expect(statsCalls(calls, 'shop')).toHaveLength(2);
  expect(within(table).queryByText('Unavailable')).not.toBeInTheDocument();
});

test('overview: a site whose statistics are still loading shows an ellipsis in the table', async () => {
  mockFetch(
    asAdmin,
    route('GET /api/admin/sites', json({ items: [shop, blog] })),
    route('GET /api/sites/shop/stats', json(stats)),
    route('GET /api/sites/blog/stats', () => new Promise<Response>(() => undefined)),
  );
  renderApp('/admin/overview');
  const user = userEvent.setup();
  // Only the site that answered is counted so far.
  expect(await screen.findByText('1,280')).toBeInTheDocument();
  const table = await openTable(user);
  const blogRow = within(table).getByRole('link', { name: 'Blog' }).closest('tr') as HTMLElement;
  expect(within(blogRow).getAllByText('…')).toHaveLength(2);
  expect(within(table).queryByText('Unavailable')).not.toBeInTheDocument();
});

test('overview: sites that exist but have no decisions yet show a dash for the opt-in rate', async () => {
  const noDecisions = { ...stats, purposes: [] };
  mockFetch(
    asAdmin,
    route('GET /api/admin/sites', json({ items: [shop, blog] })),
    route('GET /api/sites/shop/stats', json(noDecisions)),
    route(
      'GET /api/sites/blog/stats',
      json({ ...noDecisions, totals: { consents: 20, subjects: 10 } }),
    ),
  );
  renderApp('/admin/overview');
  const user = userEvent.setup();
  expect(await screen.findByText('1,300')).toBeInTheDocument();
  const tile = screen.getByText('Overall opt-in rate').closest('div') as HTMLElement;
  expect(within(tile).getByText('–')).toBeInTheDocument();
  const table = await openTable(user);
  const rows = within(table).getAllByRole('row').slice(1);
  expect(rows).toHaveLength(2);
  for (const row of rows) expect(within(row).getByText('–')).toBeInTheDocument();
});

test('overview: a failing site list can be retried', async () => {
  let failing = true;
  const { calls } = mockFetch(
    asAdmin,
    route('GET /api/admin/sites', () =>
      failing ? apiError(500, 'INTERNAL_ERROR') : json({ items: [shop] }),
    ),
    route('GET /api/sites/shop/stats', json(stats)),
  );
  renderApp('/admin/overview');
  const user = userEvent.setup();
  expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
  expect(statsCalls(calls, 'shop')).toHaveLength(0);
  failing = false;
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('1,280')).toBeInTheDocument();
});

test('overview: a platform with no site yet explains where to create one', async () => {
  mockFetch(asAdmin, route('GET /api/admin/sites', json({ items: [] })));
  renderApp('/admin/overview');
  expect(await screen.findByText('No sites yet')).toBeInTheDocument();
  expect(screen.getByText(/Create a site under Manage sites/)).toBeInTheDocument();
});

const system = { ...auditEntry, id: 'a-sys', actorId: null, actorEmail: null, ip: null };
const orphan = { ...auditEntry, id: 'a-orphan', actorEmail: null, actorId: 'u-gone' };

test('audit: an actor without an email shows their id, and no actor means the system', async () => {
  mockFetch(
    asAdmin,
    route('GET /api/admin/audit', json({ items: [auditEntry, orphan, system], nextCursor: null })),
  );
  renderApp('/admin/audit');
  const rows = (await screen.findAllByRole('row')).slice(1);
  expect(rows).toHaveLength(3);
  const [named, gone, automatic] = rows as [HTMLElement, HTMLElement, HTMLElement];
  expect(within(named).getByText('ada@example.com')).toBeInTheDocument();
  expect(within(named).getByText('203.0.113.7')).toBeInTheDocument();
  expect(within(gone).getByText('u-gone')).toBeInTheDocument();
  expect(within(automatic).getByText('System')).toBeInTheDocument();
  // No address recorded: a dash, not an empty cell.
  expect(within(automatic).getAllByText('–').length).toBeGreaterThanOrEqual(1);
  expect(within(automatic).queryByText('203.0.113.7')).not.toBeInTheDocument();
});

test('audit: a failing first page can be retried', async () => {
  let failing = true;
  const { calls } = mockFetch(
    asAdmin,
    route('GET /api/admin/audit', () =>
      failing ? apiError(500, 'INTERNAL_ERROR') : json({ items: [auditEntry], nextCursor: null }),
    ),
  );
  renderApp('/admin/audit');
  const user = userEvent.setup();
  expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  failing = false;
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Site created')).toBeInTheDocument();
  expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  expect(calls.filter((call) => call.url.pathname === '/api/admin/audit')).toHaveLength(2);
});

test('audit: a failing older page keeps what is loaded and retries that page', async () => {
  let failing = true;
  const { calls } = mockFetch(
    asAdmin,
    route('GET /api/admin/audit', (request) => {
      if (request.url.searchParams.get('cursor') === null) {
        return json({ items: [auditEntry], nextCursor: 'older' });
      }
      return failing
        ? apiError(500, 'INTERNAL_ERROR')
        : json({ items: [{ ...orphan, action: 'user.ban' }], nextCursor: null });
    }),
  );
  renderApp('/admin/audit');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Load older entries' }));
  expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
  // The first page is still on screen, and the footer still offers the next page.
  expect(screen.getByText('Site created')).toBeInTheDocument();
  expect(screen.getByText('1 entries loaded')).toBeInTheDocument();

  failing = false;
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('User banned')).toBeInTheDocument();
  expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
  expect(screen.getByText('2 entries loaded, end of log')).toBeInTheDocument();
  expect(calls.filter((call) => call.url.searchParams.get('cursor') === 'older')).toHaveLength(2);
});
