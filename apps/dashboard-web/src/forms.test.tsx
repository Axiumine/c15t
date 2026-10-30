// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { parseDomainList, siteFormSchema } from './components/site-form';
import { filterFormSchema } from './screens/site/consents';
import { admin, shop } from './test/fixtures';
import { apiError, json, mockFetch, renderApp, route } from './test/harness';

const valid = { key: 'shop', name: 'Shop', domains: 'shop.example.com', policyPreset: 'eu-opt-in' };

test('domain lists accept newlines, commas and spaces', () => {
  expect(parseDomainList('a.example.com\nb.example.com, c.example.com  d.example.com\n')).toEqual([
    'a.example.com',
    'b.example.com',
    'c.example.com',
    'd.example.com',
  ]);
  expect(parseDomainList('  \n ')).toEqual([]);
});

test('the site form accepts exactly what the shared schemas accept', () => {
  expect(siteFormSchema.safeParse(valid).success).toBe(true);
  const parsed = siteFormSchema.parse({
    ...valid,
    domains: 'Shop.Example.com\nwww.shop.example.com',
  });
  expect(parsed.domains).toEqual(['shop.example.com', 'www.shop.example.com']);

  const messages = (input: object) =>
    siteFormSchema
      .safeParse(input)
      .error?.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  expect(messages({ ...valid, key: 'Shop!' })).toEqual([
    'key: siteKey must be 3 to 40 characters: a-z, 0-9 and hyphen',
  ]);
  expect(messages({ ...valid, domains: '' })).toEqual(['domains: At least one domain is required']);
  expect(messages({ ...valid, domains: '*.example.com' })).toEqual([
    'domains: *.example.com: Wildcards are not allowed',
    'domains: *.example.com: Must be a host name such as shop.example.com',
  ]);
  expect(messages({ ...valid, domains: 'a.example.com a.example.com' })).toEqual([
    'domains: Domains must be unique',
  ]);
  expect(messages({ ...valid, name: '   ' })).toEqual(['name: This field is required']);
  expect(messages({ ...valid, policyPreset: 'everything' })).toEqual([
    'policyPreset: Choose one of the listed options',
  ]);
});

test('the record filter uses the shared range rules and drops blank fields', () => {
  expect(filterFormSchema.parse({ subject: '  sub_1 ', from: '', to: '' })).toMatchObject({
    subject: 'sub_1',
  });
  const reversed = filterFormSchema.safeParse({
    subject: '',
    from: '2026-03-10',
    to: '2026-03-01',
  });
  expect(reversed.error?.issues[0]?.message).toContain('must not be after');
  expect(filterFormSchema.safeParse({ subject: '', from: 'yesterday', to: '' }).success).toBe(
    false,
  );
});

function adminSites(extra: Parameters<typeof mockFetch>) {
  return mockFetch(
    route('GET /api/me', json(admin)),
    route('GET /api/admin/sites', json({ items: [shop] })),
    ...extra,
  );
}

test('the new-site dialog blocks bad input before any request is sent', async () => {
  const { calls } = adminSites([]);
  renderApp('/admin/sites');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'New site' }));
  const dialog = await screen.findByRole('dialog', { name: 'New site' });

  await user.type(within(dialog).getByLabelText('Site key'), 'No');
  await user.type(within(dialog).getByLabelText('Domains'), '*.example.com');
  await user.click(within(dialog).getByRole('button', { name: 'Create site' }));

  expect(
    await within(dialog).findByText('siteKey must be 3 to 40 characters: a-z, 0-9 and hyphen'),
  ).toBeInTheDocument();
  expect(within(dialog).getByText('This field is required')).toBeInTheDocument();
  expect(
    within(dialog).getByText(/\*\.example\.com: Wildcards are not allowed/),
  ).toBeInTheDocument();
  expect(within(dialog).getByLabelText('Site key')).toHaveAttribute('aria-invalid', 'true');
  expect(calls.some((call) => call.method === 'POST')).toBe(false);
});

test('a taken site key from the server lands on the key field', async () => {
  adminSites([route('POST /api/admin/sites', apiError(409, 'SITE_KEY_TAKEN'))]);
  renderApp('/admin/sites');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'New site' }));
  const dialog = await screen.findByRole('dialog', { name: 'New site' });
  await user.type(within(dialog).getByLabelText('Site key'), 'shop');
  await user.type(within(dialog).getByLabelText('Name'), 'Shop again');
  await user.type(within(dialog).getByLabelText('Domains'), 'again.example.com');
  await user.click(within(dialog).getByRole('button', { name: 'Create site' }));
  expect(await within(dialog).findByText('This site key is already in use')).toBeInTheDocument();
});

test('creating a site sends the validated payload and closes the dialog', async () => {
  const { calls } = adminSites([
    route('POST /api/admin/sites', json({ ...shop, key: 'blog', name: 'Blog' }, 201)),
  ]);
  renderApp('/admin/sites');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'New site' }));
  const dialog = await screen.findByRole('dialog', { name: 'New site' });
  await user.type(within(dialog).getByLabelText('Site key'), 'blog');
  await user.type(within(dialog).getByLabelText('Name'), 'Blog');
  await user.type(
    within(dialog).getByLabelText('Domains'),
    'Blog.Example.com{Enter}www.blog.example.com',
  );
  await user.selectOptions(within(dialog).getByLabelText('Policy preset'), 'eu-us-opt-out');
  await user.click(within(dialog).getByRole('button', { name: 'Create site' }));
  await screen.findByRole('heading', { name: 'Manage sites' });
  const post = calls.find((call) => call.method === 'POST');
  expect(post?.body).toEqual({
    key: 'blog',
    name: 'Blog',
    domains: ['blog.example.com', 'www.blog.example.com'],
    policyPreset: 'eu-us-opt-out',
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

test('editing shows the site key as read-only and sends only the editable fields', async () => {
  const { calls } = adminSites([route('PATCH /api/admin/sites/shop', json(shop))]);
  renderApp('/admin/sites');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: /^Edit/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Edit site' });
  expect(within(dialog).getByLabelText('Site key')).toHaveAttribute('readonly');
  await user.clear(within(dialog).getByLabelText('Name'));
  await user.type(within(dialog).getByLabelText('Name'), 'Shop EU');
  await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  await screen.findByRole('heading', { name: 'Manage sites' });
  const patch = calls.find((call) => call.method === 'PATCH');
  expect(patch?.body).toEqual({
    name: 'Shop EU',
    domains: ['shop.example.com', 'www.shop.example.com'],
    policyPreset: 'eu-opt-in',
  });
});

test('disabling a site asks first, and there is no delete anywhere', async () => {
  const { calls } = adminSites([
    route('PATCH /api/admin/sites/shop', json({ ...shop, status: 'disabled' })),
  ]);
  renderApp('/admin/sites');
  const user = userEvent.setup();
  expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  await user.click(await screen.findByRole('button', { name: /^Disable/ }));
  const dialog = await screen.findByRole('dialog', { name: 'Disable Shop?' });
  expect(within(dialog).getByText(/Its records are kept/)).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'Disable site' }));
  await screen.findByRole('heading', { name: 'Manage sites' });
  expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({ status: 'disabled' });
  expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
});

test('creating a user validates the email with the shared schema', async () => {
  const { calls } = mockFetch(
    route('GET /api/me', json(admin)),
    route('GET /api/admin/users', json({ items: [] })),
    route('GET /api/admin/sites', json({ items: [shop] })),
  );
  renderApp('/admin/users');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'New user' }));
  const dialog = await screen.findByRole('dialog', { name: 'New user' });
  await user.type(within(dialog).getByLabelText('Name'), 'Nia');
  await user.type(within(dialog).getByLabelText('Email'), 'not-an-email');
  await user.click(within(dialog).getByRole('button', { name: 'Create user' }));
  expect(await within(dialog).findByText('Enter a valid email address')).toBeInTheDocument();
  expect(calls.some((call) => call.method === 'POST')).toBe(false);
});
