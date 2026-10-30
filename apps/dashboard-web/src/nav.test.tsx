// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { admin, plainUser } from './test/fixtures';
import { json, mockFetch, renderApp, route } from './test/harness';

const noSites = route('GET /api/sites', json({ items: [] }));

test('an admin sees the admin links', async () => {
  mockFetch(route('GET /api/me', json(admin)), noSites);
  renderApp('/sites');
  const nav = await screen.findByRole('navigation', { name: 'Main' });
  for (const name of ['Sites', 'Overview', 'Users', 'Manage sites', 'Audit log']) {
    expect(within(nav).getByRole('link', { name })).toBeInTheDocument();
  }
});

test('a user never sees admin links, only their sites and their account', async () => {
  mockFetch(route('GET /api/me', json(plainUser)), noSites);
  renderApp('/sites');
  const nav = await screen.findByRole('navigation', { name: 'Main' });
  expect(
    within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent),
  ).toEqual(['Sites']);
  expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Audit log' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: plainUser.email })).toHaveAttribute('href', '/account');
});
