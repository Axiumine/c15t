// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { apiError, mockFetch, route } from './test/harness';

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/');
});

test('the entry point mounts the app into #root and shows the login screen to a visitor', async () => {
  mockFetch(route('GET /api/me', apiError(401, 'UNAUTHORIZED')));
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);

  await import('./main');

  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  expect(root).toContainElement(screen.getByRole('heading', { name: 'Sign in' }));
  expect(window.location.pathname).toBe('/login');
});

test('the entry point fails loudly when the page has no #root element', async () => {
  await expect(import('./main')).rejects.toThrow('Missing #root element');
});
