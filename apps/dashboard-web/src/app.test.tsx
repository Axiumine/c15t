// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { createMemoryHistory } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { queryKeys, sitesQueryOptions } from './api';
import { createApp } from './app';
import { createAppRouter } from './router';
import { plainUser } from './test/fixtures';
import { apiError, json, mockFetch, renderApp, route } from './test/harness';

const asUser = route('GET /api/me', json(plainUser));
const noSites = route('GET /api/sites', json({ items: [] }));

test('a visitor who is already signed in is sent from the login screen to the account page when a new password is due', async () => {
  mockFetch(route('GET /api/me', json({ ...plainUser, mustChangePassword: true })), noSites);
  const app = renderApp('/login');
  expect(await screen.findByText('Choose a new password to continue')).toBeInTheDocument();
  expect(app.router.state.location.pathname).toBe('/account');
});

test('a 401 that arrives on the login screen does not start another redirect', async () => {
  mockFetch(
    route('GET /api/me', apiError(401, 'UNAUTHORIZED')),
    route('GET /api/sites', apiError(401, 'UNAUTHORIZED')),
  );
  const app = renderApp('/login?redirect=%2Fsites%2Fshop');
  await screen.findByRole('heading', { name: 'Sign in' });
  const navigate = vi.spyOn(app.router, 'navigate');

  await app.queryClient.query(sitesQueryOptions()).catch(() => undefined);

  expect(navigate).not.toHaveBeenCalled();
  expect(app.router.state.location.pathname).toBe('/login');
  // The remembered target is not overwritten by the failed call.
  expect(app.router.state.location.search).toEqual({ redirect: '/sites/shop' });
});

test('PASSWORD_CHANGE_REQUIRED that arrives on the account page leaves the session data alone', async () => {
  mockFetch(
    route('GET /api/me', json({ ...plainUser, mustChangePassword: true })),
    route('GET /api/sites', apiError(403, 'PASSWORD_CHANGE_REQUIRED')),
  );
  const app = renderApp('/account');
  await screen.findByText('Choose a new password to continue');
  const navigate = vi.spyOn(app.router, 'navigate');

  await app.queryClient.query(sitesQueryOptions()).catch(() => undefined);

  expect(navigate).not.toHaveBeenCalled();
  expect(app.router.state.location.pathname).toBe('/account');
  // The profile stays cached: dropping it here would blank the screen the user is on.
  expect(app.queryClient.getQueryData(queryKeys.me)).toMatchObject({ mustChangePassword: true });
});

test('PASSWORD_CHANGE_REQUIRED while a navigation is still resolving does not redirect on its own', async () => {
  // The route guard asks /api/me, which answers with the lock. The guard owns that navigation.
  mockFetch(route('GET /api/me', apiError(403, 'PASSWORD_CHANGE_REQUIRED')));
  const app = createApp(createMemoryHistory({ initialEntries: ['/sites'] }));
  const navigate = vi.spyOn(app.router, 'navigate');

  await app.router.load();

  expect(navigate).not.toHaveBeenCalled();
  expect(app.router.state.location.pathname).toBe('/sites');
});

test('createAppRouter without a history follows the browser location', async () => {
  mockFetch(asUser, noSites);
  const router = createAppRouter(createApp().queryClient);
  window.history.replaceState(null, '', '/sites');
  try {
    await router.load();
    expect(router.state.location.pathname).toBe('/sites');
  } finally {
    window.history.replaceState(null, '', '/');
  }
});
