// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { admin, blog, shop, userSummary } from './test/fixtures';
import { json, mockFetch, renderApp, route } from './test/harness';

const PASSWORD = 'example-one-time-password';
const adminRow = userSummary({ ...admin, siteKeys: [] });
const created = userSummary({ id: 'u-new', name: 'Nia New', email: 'nia@example.com' });

function setup() {
  let users = [adminRow];
  return mockFetch(
    route('GET /api/me', json(admin)),
    route('GET /api/admin/users', () => json({ items: users })),
    route('GET /api/admin/sites', json({ items: [shop, blog] })),
    route('POST /api/admin/users', () => {
      users = [...users, created];
      return json({ user: created, oneTimePassword: PASSWORD }, 201);
    }),
    route('POST /api/admin/users/u-new/reset-password', () =>
      json({ user: created, oneTimePassword: PASSWORD }),
    ),
  );
}

async function createUser(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'New user' }));
  const dialog = await screen.findByRole('dialog', { name: 'New user' });
  await user.type(within(dialog).getByLabelText('Name'), 'Nia New');
  await user.type(within(dialog).getByLabelText('Email'), 'nia@example.com');
  await user.click(within(dialog).getByRole('checkbox', { name: /Shop/ }));
  await user.click(within(dialog).getByRole('button', { name: 'Create user' }));
}

test('the one-time password is shown once, survives Escape, and is gone after closing', async () => {
  const { calls } = setup();
  const app = renderApp('/admin/users');
  const user = userEvent.setup();
  await createUser(user);

  const dialog = await screen.findByRole('dialog', { name: 'User created' });
  expect(within(dialog).getByLabelText('One-time password')).toHaveValue(PASSWORD);
  expect(within(dialog).getByText(/shown only now/)).toBeInTheDocument();

  const post = calls.find(
    (call) => call.method === 'POST' && call.url.pathname === '/api/admin/users',
  );
  expect(post?.body).toEqual({
    name: 'Nia New',
    email: 'nia@example.com',
    role: 'user',
    siteKeys: ['shop'],
  });

  // A stray Escape or click outside must not throw the secret away.
  await user.keyboard('{Escape}');
  expect(screen.getByRole('dialog', { name: 'User created' })).toBeInTheDocument();

  await user.click(within(dialog).getByRole('button', { name: 'I have stored the password' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

  expect(screen.queryByDisplayValue(PASSWORD)).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain(PASSWORD);

  // Not kept in the Query caches either, and a refetch of the list does not bring it back.
  await app.queryClient.invalidateQueries();
  const cached = JSON.stringify([
    app.queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.state.data),
    app.queryClient
      .getMutationCache()
      .getAll()
      .map((mutation) => mutation.state),
  ]);
  expect(cached).not.toContain(PASSWORD);
  expect(await screen.findByText('nia@example.com')).toBeInTheDocument();
  expect(document.body.textContent).not.toContain(PASSWORD);
});

test('a reset password follows the same show-once rule', async () => {
  const { calls } = setup();
  renderApp('/admin/users');
  const user = userEvent.setup();
  await createUser(user);
  await user.click(await screen.findByRole('button', { name: 'I have stored the password' }));

  await user.click(await screen.findByRole('button', { name: 'Actions for nia@example.com' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Reset password' }));
  const confirm = await screen.findByRole('dialog', { name: 'Reset password?' });
  await user.click(within(confirm).getByRole('button', { name: 'Reset password' }));

  const shown = await screen.findByRole('dialog', { name: 'Password reset' });
  expect(within(shown).getByLabelText('One-time password')).toHaveValue(PASSWORD);
  await user.click(within(shown).getByRole('button', { name: 'I have stored the password' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(document.body.textContent).not.toContain(PASSWORD);
  expect(calls.some((call) => call.url.pathname === '/api/admin/users/u-new/reset-password')).toBe(
    true,
  );
});

test('there is no reset or ban for your own row', async () => {
  setup();
  renderApp('/admin/users');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: `Actions for ${admin.email}` }));
  expect(await screen.findByRole('menuitem', { name: 'Assign sites' })).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'Reset password' })).not.toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'Ban user' })).not.toBeInTheDocument();
});
