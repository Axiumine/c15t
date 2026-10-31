// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { admin, blog, shop } from './test/fixtures';
import { apiError, json, mockFetch, renderApp, route } from './test/harness';

// These flows render a lot (Radix portals, forms, tables): never depend on the 1 s default.
configure({ asyncUtilTimeout: 8000 });
vi.setConfig({ testTimeout: 30_000 });

const disabledBlog = { ...blog, status: 'disabled' as const };
const asAdmin = route('GET /api/me', json(admin));

test('a failing site list offers a retry that loads it', async () => {
  let failing = true;
  const { calls } = mockFetch(
    asAdmin,
    route('GET /api/admin/sites', () =>
      failing ? apiError(500, 'INTERNAL_ERROR') : json({ items: [shop] }),
    ),
  );
  renderApp('/admin/sites');
  const user = userEvent.setup();
  expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
  failing = false;
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('link', { name: 'Shop' })).toHaveAttribute('href', '/sites/shop');
  expect(calls.filter((call) => call.url.pathname === '/api/admin/sites')).toHaveLength(2);
});

test('with no site yet, the empty state offers the same New site dialog', async () => {
  mockFetch(asAdmin, route('GET /api/admin/sites', json({ items: [] })));
  renderApp('/admin/sites');
  const user = userEvent.setup();
  expect(await screen.findByText('No sites yet')).toBeInTheDocument();
  expect(screen.getByText(/Create the first site/)).toBeInTheDocument();
  const buttons = screen.getAllByRole('button', { name: 'New site' });
  expect(buttons).toHaveLength(2);
  await user.click(buttons[1] as HTMLElement);
  const dialog = await screen.findByRole('dialog', { name: 'New site' });
  expect(within(dialog).getByText(/nginx lines shown on the site Setup tab/)).toBeInTheDocument();
  expect(within(dialog).getByLabelText('Site key')).not.toHaveAttribute('readonly');
});

test('Escape closes the site dialog, and editing again starts from the saved values', async () => {
  const { calls } = mockFetch(
    asAdmin,
    route('GET /api/admin/sites', json({ items: [shop, disabledBlog] })),
  );
  renderApp('/admin/sites');
  const user = userEvent.setup();
  await user.click((await screen.findAllByRole('button', { name: /^Edit/ }))[0] as HTMLElement);
  let dialog = await screen.findByRole('dialog', { name: 'Edit site' });
  expect(within(dialog).getByText(/reach the consent service within moments/)).toBeInTheDocument();
  await user.type(within(dialog).getByLabelText('Name'), ' draft');
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

  await user.click((await screen.findAllByRole('button', { name: /^Edit/ }))[0] as HTMLElement);
  dialog = await screen.findByRole('dialog', { name: 'Edit site' });
  expect(within(dialog).getByLabelText('Name')).toHaveValue('Shop');
  expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
});

test('a disabled site can be enabled again, after asking', async () => {
  const { calls } = mockFetch(
    asAdmin,
    route('GET /api/admin/sites', json({ items: [disabledBlog] })),
    route('PATCH /api/admin/sites/blog', json(blog)),
  );
  renderApp('/admin/sites');
  const user = userEvent.setup();
  expect(await screen.findByText('Disabled')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Disable/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /^Enable/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Enable Blog?' });
  expect(within(dialog).getByText(/starts serving its banner/)).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'Enable site' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ status: 'active' });
});

test('Cancel on the status question sends nothing, and a failed change shows its error until closed', async () => {
  let failing = true;
  const { calls } = mockFetch(
    asAdmin,
    route('GET /api/admin/sites', json({ items: [shop] })),
    route('PATCH /api/admin/sites/shop', () =>
      failing ? apiError(500, 'INTERNAL_ERROR') : json({ ...shop, status: 'disabled' }),
    ),
  );
  renderApp('/admin/sites');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /^Disable/ }));
  let dialog = await screen.findByRole('dialog', { name: 'Disable Shop?' });
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(calls.some((call) => call.method === 'PATCH')).toBe(false);

  await user.click(screen.getByRole('button', { name: /^Disable/ }));
  dialog = await screen.findByRole('dialog', { name: 'Disable Shop?' });
  await user.click(within(dialog).getByRole('button', { name: 'Disable site' }));
  expect(await within(dialog).findByText('Something went wrong. Try again.')).toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Disable Shop?' })).toBeInTheDocument();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

  failing = false;
  await user.click(screen.getByRole('button', { name: /^Disable/ }));
  dialog = await screen.findByRole('dialog', { name: 'Disable Shop?' });
  expect(within(dialog).queryByText('Something went wrong. Try again.')).not.toBeInTheDocument();
});
