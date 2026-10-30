// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { plainUser } from './test/fixtures';
import { apiError, json, mockFetch, renderApp, route } from './test/harness';

const session = { token: 't', user: { id: plainUser.id } };

/** A tiny stateful backend: who is signed in, and whether the password change is pending. */
function backend(options: { mustChangePassword: boolean }) {
  const state = { signedIn: false, mustChange: options.mustChangePassword };
  const handlers = [
    route('GET /api/me', () =>
      state.signedIn
        ? json({ ...plainUser, mustChangePassword: state.mustChange })
        : apiError(401, 'UNAUTHORIZED'),
    ),
    route('POST /api/auth/sign-in/email', () => {
      state.signedIn = true;
      return json(session);
    }),
    route('POST /api/auth/change-password', () => {
      state.mustChange = false;
      return json(session);
    }),
    route('GET /api/sites', json({ items: [] })),
  ];
  return { state, handlers };
}

test('signing in with valid credentials opens the sites list', async () => {
  const { handlers } = backend({ mustChangePassword: false });
  const { calls } = mockFetch(...handlers);
  const app = renderApp('/login');
  const user = userEvent.setup();

  await user.type(await screen.findByLabelText('Email'), '  Una@Example.com ');
  await user.type(screen.getByLabelText('Password'), 'correct horse battery');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));

  expect(await screen.findByRole('heading', { name: 'Sites' })).toBeInTheDocument();
  expect(app.router.state.location.pathname).toBe('/sites');
  const signIn = calls.find((call) => call.url.pathname === '/api/auth/sign-in/email');
  // The shared schema trims and lowercases the email before it is sent.
  expect(signIn?.body).toMatchObject({
    email: 'una@example.com',
    password: 'correct horse battery',
  });
});

test('signing in returns to the page that was asked for', async () => {
  const { handlers } = backend({ mustChangePassword: false });
  mockFetch(...handlers);
  const app = renderApp('/account');
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Email'), 'una@example.com');
  await user.type(screen.getByLabelText('Password'), 'correct horse battery');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('heading', { name: 'Account' })).toBeInTheDocument();
  expect(app.router.state.location.pathname).toBe('/account');
});

test('wrong credentials show one generic message and keep the form', async () => {
  mockFetch(
    route('GET /api/me', apiError(401, 'UNAUTHORIZED')),
    route(
      'POST /api/auth/sign-in/email',
      json({ code: 'INVALID_EMAIL_OR_PASSWORD', message: 'x' }, 401),
    ),
  );
  renderApp('/login');
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Email'), 'una@example.com');
  await user.type(screen.getByLabelText('Password'), 'wrong password!!');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
});

test('rate limiting and a disabled account have their own messages', async () => {
  let status = 429;
  mockFetch(
    route('GET /api/me', apiError(401, 'UNAUTHORIZED')),
    route('POST /api/auth/sign-in/email', () =>
      json(status === 403 ? { code: 'BANNED_USER', message: 'x' } : { message: 'x' }, status),
    ),
  );
  renderApp('/login');
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Email'), 'una@example.com');
  await user.type(screen.getByLabelText('Password'), 'whatever-password');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText(/Too many attempts/)).toBeInTheDocument();
  status = 403;
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText(/account is disabled/)).toBeInTheDocument();
});

test('a rejected origin is not reported as a disabled account', async () => {
  // dashboard-api answers a wrong Origin with its platform error body, before any password check.
  mockFetch(
    route('GET /api/me', apiError(401, 'UNAUTHORIZED')),
    route('POST /api/auth/sign-in/email', apiError(403, 'FORBIDDEN')),
  );
  renderApp('/login');
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Email'), 'una@example.com');
  await user.type(screen.getByLabelText('Password'), 'correct horse battery');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByText(/not the dashboard's official address/)).toBeInTheDocument();
  expect(screen.getByText(/BETTER_AUTH_URL/)).toBeInTheDocument();
  expect(screen.queryByText(/account is disabled/)).not.toBeInTheDocument();
});

test('an empty form is rejected by the shared schema before any request is sent', async () => {
  const { calls } = mockFetch(route('GET /api/me', apiError(401, 'UNAUTHORIZED')));
  renderApp('/login');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Sign in' }));
  expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
  expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  expect(calls.some((call) => call.url.pathname.includes('sign-in'))).toBe(false);
});

test('first login with a temporary password forces a change, then opens the app', async () => {
  const { handlers, state } = backend({ mustChangePassword: true });
  const { calls } = mockFetch(...handlers);
  const app = renderApp('/login');
  const user = userEvent.setup();

  await user.type(await screen.findByLabelText('Email'), 'una@example.com');
  await user.type(screen.getByLabelText('Password'), 'Temp-password-123');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));

  // Locked on the account screen until the password is replaced.
  expect(await screen.findByText('Choose a new password to continue')).toBeInTheDocument();
  expect(app.router.state.location.pathname).toBe('/account');

  await user.type(screen.getByLabelText('Current password'), 'Temp-password-123');
  await user.type(screen.getByLabelText('New password'), 'a-much-better-passphrase');
  await user.type(screen.getByLabelText('Repeat new password'), 'a-much-better-passphrase');
  await user.click(screen.getByRole('button', { name: 'Change password' }));

  expect(await screen.findByRole('heading', { name: 'Sites' })).toBeInTheDocument();
  expect(state.mustChange).toBe(false);
  expect(app.router.state.location.pathname).toBe('/sites');
  const change = calls.find((call) => call.url.pathname === '/api/auth/change-password');
  expect(change?.body).toEqual({
    currentPassword: 'Temp-password-123',
    newPassword: 'a-much-better-passphrase',
    revokeOtherSessions: true,
  });
});

test('the password form enforces the shared rules and shows a wrong current password', async () => {
  const { handlers } = backend({ mustChangePassword: false });
  mockFetch(
    route('POST /api/auth/change-password', json({ code: 'INVALID_PASSWORD', message: 'x' }, 400)),
    ...handlers,
  );
  renderApp('/login');
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Email'), 'una@example.com');
  await user.type(screen.getByLabelText('Password'), 'correct horse battery');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('heading', { name: 'Sites' });
  await user.click(screen.getByRole('link', { name: plainUser.email }));

  await user.type(await screen.findByLabelText('Current password'), 'old-password-value');
  await user.type(screen.getByLabelText('New password'), 'short');
  await user.type(screen.getByLabelText('Repeat new password'), 'different');
  await user.click(screen.getByRole('button', { name: 'Change password' }));
  expect(await screen.findByText('Must be at least 12 characters')).toBeInTheDocument();
  expect(screen.getByText('The passwords do not match')).toBeInTheDocument();

  await user.clear(screen.getByLabelText('New password'));
  await user.clear(screen.getByLabelText('Repeat new password'));
  await user.type(screen.getByLabelText('New password'), 'old-password-value');
  await user.type(screen.getByLabelText('Repeat new password'), 'old-password-value');
  await user.click(screen.getByRole('button', { name: 'Change password' }));
  expect(
    await screen.findByText('The new password must differ from the current one'),
  ).toBeInTheDocument();

  await user.clear(screen.getByLabelText('New password'));
  await user.clear(screen.getByLabelText('Repeat new password'));
  await user.type(screen.getByLabelText('New password'), 'a-brand-new-passphrase');
  await user.type(screen.getByLabelText('Repeat new password'), 'a-brand-new-passphrase');
  await user.click(screen.getByRole('button', { name: 'Change password' }));
  expect(await screen.findByText('The current password is not correct.')).toBeInTheDocument();
});

test('signing out clears the session and returns to the login screen', async () => {
  const { handlers, state } = backend({ mustChangePassword: false });
  state.signedIn = true;
  const { calls } = mockFetch(
    route('POST /api/auth/sign-out', () => {
      state.signedIn = false;
      return json({ success: true });
    }),
    ...handlers,
  );
  const app = renderApp('/sites');
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Sign out' }));
  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  await waitFor(() => expect(app.queryClient.getQueryCache().getAll()).toHaveLength(1));
  expect(calls.some((call) => call.url.pathname === '/api/auth/sign-out')).toBe(true);
});
