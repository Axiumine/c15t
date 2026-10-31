// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { queryKeys } from './api';
import { plainUser } from './test/fixtures';
import { apiError, json, mockFetch, renderApp, route } from './test/harness';

const asUser = route('GET /api/me', json(plainUser));

test('a voluntary password change confirms in place and keeps the user on the account page', async () => {
  const { calls } = mockFetch(
    asUser,
    route('POST /api/auth/change-password', json({ token: 't' })),
  );
  const app = renderApp('/account');
  const user = userEvent.setup();

  await user.type(await screen.findByLabelText('Current password'), 'old-password-value');
  await user.type(screen.getByLabelText('New password'), 'a-much-better-passphrase');
  await user.type(screen.getByLabelText('Repeat new password'), 'a-much-better-passphrase');
  await user.click(screen.getByRole('button', { name: 'Change password' }));

  expect(await screen.findByRole('status')).toHaveTextContent('Password changed.');
  expect(app.router.state.location.pathname).toBe('/account');
  // The form is emptied, so the new password does not linger in the field.
  expect(screen.getByLabelText('New password')).toHaveValue('');
  expect(screen.getByLabelText('Current password')).toHaveValue('');
  const change = calls.find((call) => call.url.pathname === '/api/auth/change-password');
  expect(change?.body).toEqual({
    currentPassword: 'old-password-value',
    newPassword: 'a-much-better-passphrase',
    revokeOtherSessions: true,
  });
  // The profile is read again after the change (the flag may have flipped).
  expect(calls.filter((call) => call.url.pathname === '/api/me').length).toBeGreaterThanOrEqual(2);
});

test('a second attempt clears the previous confirmation and shows the new failure', async () => {
  let accept = true;
  mockFetch(
    asUser,
    route('POST /api/auth/change-password', () =>
      accept ? json({ token: 't' }) : json({ code: 'INVALID_PASSWORD', message: 'x' }, 400),
    ),
  );
  renderApp('/account');
  const user = userEvent.setup();
  const fill = async () => {
    await user.type(screen.getByLabelText('Current password'), 'old-password-value');
    await user.type(screen.getByLabelText('New password'), 'a-much-better-passphrase');
    await user.type(screen.getByLabelText('Repeat new password'), 'a-much-better-passphrase');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
  };
  await screen.findByLabelText('Current password');
  await fill();
  expect(await screen.findByRole('status')).toHaveTextContent('Password changed.');

  accept = false;
  await fill();
  expect(await screen.findByText('The current password is not correct.')).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('the session card signs the user out of this browser', async () => {
  let signedIn = true;
  const { calls } = mockFetch(
    route('GET /api/me', () => (signedIn ? json(plainUser) : apiError(401, 'UNAUTHORIZED'))),
    route('POST /api/auth/sign-out', () => {
      signedIn = false;
      return json({ success: true });
    }),
  );
  const app = renderApp('/account');
  const user = userEvent.setup();
  await screen.findByRole('heading', { name: 'Account' });
  const card = screen.getByText('Sign out of this browser.').parentElement?.parentElement;
  expect(card).toBeInstanceOf(HTMLElement);
  await user.click(within(card as HTMLElement).getByRole('button', { name: 'Sign out' }));

  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  expect(app.router.state.location.pathname).toBe('/login');
  expect(calls.some((call) => call.url.pathname === '/api/auth/sign-out')).toBe(true);
});

test('while the profile reloads the page shows a placeholder, and a failed reload can be retried', async () => {
  let release!: (response: Response) => void;
  const reloadAnswer = new Promise<Response>((resolve) => {
    release = resolve;
  });
  let hold = false;
  mockFetch(route('GET /api/me', () => (hold ? reloadAnswer : json(plainUser))));
  const app = renderApp('/account');
  await screen.findByRole('heading', { name: 'Account' });

  hold = true;
  act(() => {
    void app.queryClient.resetQueries({ queryKey: queryKeys.me, exact: true });
  });
  expect(await screen.findByText('Loading your account…')).toBeInTheDocument();
  // The shell keeps the user it learned from the route guard while the live copy is reloading.
  expect(screen.getByRole('link', { name: plainUser.email })).toBeInTheDocument();

  await act(async () => {
    release(apiError(500, 'INTERNAL_ERROR', 'select * from secret failed'));
  });
  expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
  expect(screen.queryByText(/secret/)).not.toBeInTheDocument();

  hold = false;
  await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('heading', { name: 'Account' })).toBeInTheDocument();
  expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
});
