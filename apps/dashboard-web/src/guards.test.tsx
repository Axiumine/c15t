// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { screen, waitFor } from '@testing-library/react';
import { expect, test } from 'vitest';
import { admin, plainUser } from './test/fixtures';
import { apiError, json, mockFetch, renderApp, route } from './test/harness';

const noSites = route('GET /api/sites', json({ items: [] }));

test('an anonymous visitor is sent to the login screen, and the target is remembered', async () => {
  mockFetch(route('GET /api/me', apiError(401, 'UNAUTHORIZED')));
  const app = renderApp('/sites/shop?range=7d');
  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  expect(app.router.state.location.pathname).toBe('/login');
  expect(app.router.state.location.search).toEqual({ redirect: '/sites/shop?range=7d' });
});

test('a signed-in visitor skips the login screen', async () => {
  mockFetch(route('GET /api/me', json(plainUser)), noSites);
  const app = renderApp('/login');
  expect(await screen.findByRole('heading', { name: 'Sites' })).toBeInTheDocument();
  expect(app.router.state.location.pathname).toBe('/sites');
});

test('while an admin-set password is pending, every page redirects to the account screen', async () => {
  mockFetch(route('GET /api/me', json({ ...plainUser, mustChangePassword: true })), noSites);
  const app = renderApp('/sites');
  expect(await screen.findByText('Choose a new password to continue')).toBeInTheDocument();
  expect(app.router.state.location.pathname).toBe('/account');
  // The locked dashboard shows no navigation, only the account and sign-out controls.
  expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument();
});

test('a user who types an admin URL is bounced to the sites list without an admin request', async () => {
  const { calls } = mockFetch(route('GET /api/me', json(plainUser)), noSites);
  const app = renderApp('/admin/users');
  expect(await screen.findByRole('heading', { name: 'Sites' })).toBeInTheDocument();
  expect(app.router.state.location.pathname).toBe('/sites');
  expect(calls.some((call) => call.url.pathname.startsWith('/api/admin'))).toBe(false);
});

test('an admin may open admin pages, and /admin lands on the overview', async () => {
  mockFetch(route('GET /api/me', json(admin)), route('GET /api/admin/sites', json({ items: [] })));
  const app = renderApp('/admin');
  expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
  expect(app.router.state.location.pathname).toBe('/admin/overview');
});

test('the root path leads to the sites list', async () => {
  mockFetch(route('GET /api/me', json(plainUser)), noSites);
  const app = renderApp('/');
  expect(await screen.findByRole('heading', { name: 'Sites' })).toBeInTheDocument();
  expect(app.router.state.location.pathname).toBe('/sites');
});

test('a 401 in the middle of a session sends the user back to the login screen', async () => {
  let expired = false;
  mockFetch(
    route('GET /api/me', () => (expired ? apiError(401, 'UNAUTHORIZED') : json(plainUser))),
    route('GET /api/sites', () => {
      expired = true;
      return apiError(401, 'UNAUTHORIZED', 'Authentication is required');
    }),
  );
  const app = renderApp('/sites');
  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  expect(app.router.state.location.search).toEqual({ redirect: '/sites' });
  // Nothing of the previous session stays in memory.
  await waitFor(() =>
    expect(app.queryClient.getQueryCache().find({ queryKey: ['sites'] })).toBeUndefined(),
  );
});

test('PASSWORD_CHANGE_REQUIRED from any call forces the change-password screen', async () => {
  let locked = false;
  mockFetch(
    route('GET /api/me', () => json({ ...plainUser, mustChangePassword: locked })),
    route('GET /api/sites', () => {
      locked = true;
      return apiError(403, 'PASSWORD_CHANGE_REQUIRED');
    }),
  );
  const app = renderApp('/sites');
  expect(await screen.findByText('Choose a new password to continue')).toBeInTheDocument();
  await waitFor(() => expect(app.router.state.location.pathname).toBe('/account'));
});

test('an unknown path shows a not-found page', async () => {
  mockFetch(route('GET /api/me', json(plainUser)), noSites);
  renderApp('/nothing-here');
  expect(await screen.findByText('Page not found')).toBeInTheDocument();
});

test('a 503 while checking the session shows a friendly retry instead of a blank page', async () => {
  let up = false;
  mockFetch(
    route('GET /api/me', () => (up ? json(plainUser) : apiError(503, 'SERVICE_UNAVAILABLE'))),
    noSites,
  );
  renderApp('/sites');
  const retry = await screen.findByRole('button', { name: 'Try again' }, { timeout: 8000 });
  expect(screen.getByText(/try again in a moment/i)).toBeInTheDocument();
  up = true;
  retry.click();
  expect(await screen.findByRole('heading', { name: 'Sites' })).toBeInTheDocument();
}, 15000);
