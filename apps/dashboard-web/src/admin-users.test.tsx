// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { configure, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { admin, blog, shop, userSummary } from './test/fixtures';
import { apiError, type Handler, json, mockFetch, renderApp, route } from './test/harness';

// These flows render a lot (Radix portals, forms, tables): never depend on the 1 s default.
configure({ asyncUtilTimeout: 8000 });
vi.setConfig({ testTimeout: 30_000 });

const adminRow = userSummary({ ...admin, siteKeys: [] });
const una = userSummary();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup(options: { sites?: unknown[]; users?: unknown[]; extra?: Handler[] } = {}) {
  return mockFetch(
    route('GET /api/me', json(admin)),
    route('GET /api/admin/sites', json({ items: options.sites ?? [shop, blog] })),
    route('GET /api/admin/users', json({ items: options.users ?? [adminRow, una] })),
    ...(options.extra ?? []),
  );
}

async function openMenu(user: ReturnType<typeof userEvent.setup>, email: string, item: string) {
  await user.click(await screen.findByRole('button', { name: `Actions for ${email}` }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

async function openNewUser(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'New user' }));
  return screen.findByRole('dialog', { name: 'New user' });
}

async function fillNewUser(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
  await user.type(within(dialog).getByLabelText('Name'), 'Nia New');
  await user.type(within(dialog).getByLabelText('Email'), 'nia@example.com');
}

test('the user list shows the assigned sites, or "None" when there are none', async () => {
  setup({
    users: [adminRow, una, userSummary({ id: 'u-two', email: 'two@example.com', siteKeys: [] })],
  });
  renderApp('/admin/users');
  expect(await screen.findByText('two@example.com')).toBeInTheDocument();
  expect(screen.getByText('shop')).toBeInTheDocument();
  expect(screen.getByText('None')).toBeInTheDocument();
  expect(screen.getByText('All sites')).toBeInTheDocument();
});

test('a failing user list offers a retry that loads it', async () => {
  let failing = true;
  const { calls } = mockFetch(
    route('GET /api/me', json(admin)),
    route('GET /api/admin/sites', json({ items: [shop] })),
    route('GET /api/admin/users', () =>
      failing ? apiError(500, 'INTERNAL_ERROR') : json({ items: [una] }),
    ),
  );
  renderApp('/admin/users');
  const user = userEvent.setup();
  expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
  failing = false;
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('una@example.com')).toBeInTheDocument();
  expect(calls.filter((call) => call.url.pathname === '/api/admin/users')).toHaveLength(2);
});

test('the new-user dialog says so when no site exists, and Escape abandons it', async () => {
  const { calls } = setup({ sites: [] });
  renderApp('/admin/users');
  const user = userEvent.setup();
  const dialog = await openNewUser(user);
  expect(within(dialog).getByText('No sites exist yet.')).toBeInTheDocument();
  expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();

  await user.type(within(dialog).getByLabelText('Name'), 'Draft');
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(calls.some((call) => call.method === 'POST')).toBe(false);

  // Abandoning resets the form: the draft is not there when the dialog is opened again.
  const again = await openNewUser(user);
  expect(within(again).getByLabelText('Name')).toHaveValue('');
});

test('the site picker flags disabled sites, and unticking a site removes it from the request', async () => {
  const created = userSummary({ id: 'u-new', name: 'Nia New', email: 'nia@example.com' });
  const { calls } = setup({
    sites: [shop, { ...blog, status: 'disabled' as const }],
    extra: [
      route(
        'POST /api/admin/users',
        json({ user: created, oneTimePassword: 'example-one-time-password' }, 201),
      ),
    ],
  });
  renderApp('/admin/users');
  const user = userEvent.setup();
  const dialog = await openNewUser(user);
  expect(within(dialog).getByText('(disabled)')).toBeInTheDocument();
  await fillNewUser(user, dialog);
  const shopBox = within(dialog).getByRole('checkbox', { name: /Shop/ });
  await user.click(shopBox);
  await user.click(within(dialog).getByRole('checkbox', { name: /Blog/ }));
  expect(shopBox).toBeChecked();
  await user.click(shopBox);
  expect(shopBox).not.toBeChecked();
  await user.click(within(dialog).getByRole('button', { name: 'Create user' }));
  await screen.findByRole('dialog', { name: 'User created' });
  const post = calls.find((call) => call.method === 'POST');
  expect(post?.body).toEqual({
    name: 'Nia New',
    email: 'nia@example.com',
    role: 'user',
    siteKeys: ['blog'],
  });
});

test('a taken email from the server lands on the email field and keeps the dialog open', async () => {
  setup({ extra: [route('POST /api/admin/users', apiError(409, 'EMAIL_TAKEN'))] });
  renderApp('/admin/users');
  const user = userEvent.setup();
  const dialog = await openNewUser(user);
  await fillNewUser(user, dialog);
  await user.click(within(dialog).getByRole('button', { name: 'Create user' }));
  expect(
    await within(dialog).findByText('A user with this email already exists'),
  ).toBeInTheDocument();
  expect(within(dialog).getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.queryByRole('dialog', { name: 'User created' })).not.toBeInTheDocument();
});

test('other server rejections are shown above the form: the first issue, or a safe message', async () => {
  const answers = [
    () =>
      apiError(400, 'VALIDATION_ERROR', 'Invalid input', [
        { path: 'name', message: 'The server did not like this name' },
      ]),
    () => apiError(500, 'INTERNAL_ERROR', 'SELECT * FROM secrets'),
  ];
  setup({ extra: [route('POST /api/admin/users', () => (answers.shift() as () => Response)())] });
  renderApp('/admin/users');
  const user = userEvent.setup();
  const dialog = await openNewUser(user);
  await fillNewUser(user, dialog);
  await user.click(within(dialog).getByRole('button', { name: 'Create user' }));
  expect(await within(dialog).findByText('The server did not like this name')).toBeInTheDocument();

  await user.click(within(dialog).getByRole('button', { name: 'Create user' }));
  expect(await within(dialog).findByText('Something went wrong. Try again.')).toBeInTheDocument();
  expect(within(dialog).queryByText('The server did not like this name')).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain('SELECT');
});

test('editing only the name sends only the name, and the dialog closes', async () => {
  const { calls } = setup({
    extra: [route('PATCH /api/admin/users/u-user', json({ ...una, name: 'Una Renamed' }))],
  });
  renderApp('/admin/users');
  const user = userEvent.setup();
  await openMenu(user, una.email, 'Edit name and role');
  const dialog = await screen.findByRole('dialog', { name: 'Edit user' });
  expect(within(dialog).getByText(/The email cannot be changed/)).toHaveTextContent(una.email);
  expect(within(dialog).getByLabelText('Name')).toHaveValue(una.name);
  await user.clear(within(dialog).getByLabelText('Name'));
  await user.type(within(dialog).getByLabelText('Name'), 'Una Renamed');
  await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ name: 'Una Renamed' });
});

test('saving an unchanged user closes the dialog without a request', async () => {
  const { calls } = setup();
  renderApp('/admin/users');
  const user = userEvent.setup();
  await openMenu(user, una.email, 'Edit name and role');
  const dialog = await screen.findByRole('dialog', { name: 'Edit user' });
  await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(calls.some((call) => call.method === 'PATCH')).toBe(false);
});

test('Escape and Cancel close the edit dialog, and the next user starts from their own values', async () => {
  const other = userSummary({ id: 'u-other', name: 'Otto Other', email: 'otto@example.com' });
  setup({ users: [adminRow, una, other] });
  renderApp('/admin/users');
  const user = userEvent.setup();
  await openMenu(user, una.email, 'Edit name and role');
  let dialog = await screen.findByRole('dialog', { name: 'Edit user' });
  await user.type(within(dialog).getByLabelText('Name'), ' typed');
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

  await openMenu(user, other.email, 'Edit name and role');
  dialog = await screen.findByRole('dialog', { name: 'Edit user' });
  expect(within(dialog).getByLabelText('Name')).toHaveValue('Otto Other');
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('assigning sites to an administrator says they see every site anyway', async () => {
  setup();
  renderApp('/admin/users');
  const user = userEvent.setup();
  await openMenu(user, admin.email, 'Assign sites');
  const dialog = await screen.findByRole('dialog', { name: 'Assign sites' });
  expect(within(dialog).getByText(/Administrators see every site regardless/)).toBeInTheDocument();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

test('a regular user gets no administrator hint, and Cancel leaves the assignments alone', async () => {
  const { calls } = setup();
  renderApp('/admin/users');
  const user = userEvent.setup();
  await openMenu(user, una.email, 'Assign sites');
  const dialog = await screen.findByRole('dialog', { name: 'Assign sites' });
  expect(within(dialog).queryByText(/Administrators see every site/)).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole('checkbox', { name: /Blog/ }));
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(calls.some((call) => call.method === 'PUT')).toBe(false);
});

test('saving the assignments shows progress, then the server error if it fails', async () => {
  const gate = deferred<Response>();
  setup({ extra: [route('PUT /api/admin/users/u-user/sites', () => gate.promise)] });
  renderApp('/admin/users');
  const user = userEvent.setup();
  await openMenu(user, una.email, 'Assign sites');
  const dialog = await screen.findByRole('dialog', { name: 'Assign sites' });
  await user.click(within(dialog).getByRole('button', { name: 'Save assignments' }));
  const saving = await within(dialog).findByRole('button', { name: 'Saving…' });
  expect(saving).toBeDisabled();

  gate.resolve(apiError(500, 'INTERNAL_ERROR'));
  expect(await within(dialog).findByText('Something went wrong. Try again.')).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Save assignments' })).toBeEnabled();
  expect(screen.getByRole('dialog', { name: 'Assign sites' })).toBeInTheDocument();
});

test('banning with no reason and the default duration sends an empty ban', async () => {
  const { calls } = setup({
    extra: [route('POST /api/admin/users/u-user/ban', json(userSummary({ banned: true })))],
  });
  renderApp('/admin/users');
  const user = userEvent.setup();
  await openMenu(user, una.email, 'Ban user');
  const dialog = await screen.findByRole('dialog', { name: 'Ban user' });
  expect(within(dialog).getByText(/is signed out everywhere/)).toHaveTextContent(una.email);
  await user.click(within(dialog).getByRole('button', { name: 'Ban user' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(calls.find((call) => call.url.pathname.endsWith('/ban'))?.body).toEqual({});
});

test('a failed ban stays open with the reason, and Escape closes it without a request', async () => {
  const { calls } = setup({
    extra: [route('POST /api/admin/users/u-user/ban', apiError(403, 'FORBIDDEN', 'Not allowed'))],
  });
  renderApp('/admin/users');
  const user = userEvent.setup();
  await openMenu(user, una.email, 'Ban user');
  const dialog = await screen.findByRole('dialog', { name: 'Ban user' });
  await user.type(within(dialog).getByLabelText('Reason (optional)'), 'abuse');
  await user.click(within(dialog).getByRole('button', { name: 'Ban user' }));
  expect(await within(dialog).findByText('Not allowed')).toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Ban user' })).toBeInTheDocument();

  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(calls.filter((call) => call.url.pathname.endsWith('/ban'))).toHaveLength(1);
});

test('revoking sessions asks first, and Cancel sends nothing', async () => {
  const { calls } = setup({
    extra: [route('POST /api/admin/users/u-user/revoke-sessions', json(una))],
  });
  renderApp('/admin/users');
  const user = userEvent.setup();
  await openMenu(user, una.email, 'Revoke sessions');
  let confirm = await screen.findByRole('dialog', { name: 'Revoke all sessions?' });
  expect(within(confirm).getByText(/signed out on every device/)).toHaveTextContent(una.email);
  await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(calls.some((call) => call.url.pathname.endsWith('/revoke-sessions'))).toBe(false);

  await openMenu(user, una.email, 'Revoke sessions');
  confirm = await screen.findByRole('dialog', { name: 'Revoke all sessions?' });
  await user.click(within(confirm).getByRole('button', { name: 'Revoke sessions' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(calls.some((call) => call.url.pathname.endsWith('/revoke-sessions'))).toBe(true);
});

test('a failing confirmation shows the error, and closing it clears the error for the next time', async () => {
  let failing = true;
  setup({
    extra: [
      route('POST /api/admin/users/u-user/revoke-sessions', () =>
        failing ? apiError(500, 'INTERNAL_ERROR') : json(una),
      ),
    ],
  });
  renderApp('/admin/users');
  const user = userEvent.setup();
  await openMenu(user, una.email, 'Revoke sessions');
  let confirm = await screen.findByRole('dialog', { name: 'Revoke all sessions?' });
  await user.click(within(confirm).getByRole('button', { name: 'Revoke sessions' }));
  expect(await within(confirm).findByText('Something went wrong. Try again.')).toBeInTheDocument();
  await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

  failing = false;
  await openMenu(user, una.email, 'Revoke sessions');
  confirm = await screen.findByRole('dialog', { name: 'Revoke all sessions?' });
  expect(within(confirm).queryByText('Something went wrong. Try again.')).not.toBeInTheDocument();
});
