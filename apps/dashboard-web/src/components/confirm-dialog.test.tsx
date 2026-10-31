// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { ApiError } from '../api';
import { ConfirmDialog } from './confirm-dialog';

function setup(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onOpenChange = vi.fn();
  const onConfirm = vi.fn();
  const view = render(
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title="Disable site?"
      description="Visitors stop being served."
      confirmLabel="Disable"
      pending={false}
      error={null}
      onConfirm={onConfirm}
      {...props}
    />,
  );
  return { onOpenChange, onConfirm, ...view };
}

test('shows the question and runs the action only when confirmed', async () => {
  const { onConfirm, onOpenChange } = setup();
  const dialog = screen.getByRole('dialog', { name: 'Disable site?' });
  expect(within(dialog).getByText('Visitors stop being served.')).toBeInTheDocument();
  expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  expect(onConfirm).not.toHaveBeenCalled();

  await userEvent.click(within(dialog).getByRole('button', { name: 'Disable' }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  expect(onOpenChange).not.toHaveBeenCalled();
});

test('Cancel closes the dialog without confirming', async () => {
  const { onConfirm, onOpenChange } = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(onConfirm).not.toHaveBeenCalled();
});

test('a destructive confirmation is styled as such, a normal one is not', () => {
  const { unmount } = setup({ destructive: true });
  expect(screen.getByRole('button', { name: 'Disable' }).className).toContain('bg-destructive');
  unmount();
  setup();
  expect(screen.getByRole('button', { name: 'Disable' }).className).not.toContain('bg-destructive');
  expect(screen.getByRole('button', { name: 'Disable' }).className).toContain('bg-primary');
});

test('while the request runs the confirm button is disabled and says so', () => {
  setup({ pending: true });
  const working = screen.getByRole('button', { name: 'Working…' });
  expect(working).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Disable' })).not.toBeInTheDocument();
});

test('a failed request is explained inside the dialog', () => {
  setup({
    error: new ApiError({
      status: 409,
      code: 'LAST_ADMIN',
      message: 'The last admin cannot be removed',
    }),
  });
  expect(screen.getByRole('alert')).toHaveTextContent('The last admin cannot be removed');
});

test('an unknown failure shows the generic message and never the raw error', () => {
  setup({ error: new Error('SELECT * FROM secrets') });
  expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
  expect(document.body.textContent).not.toContain('SELECT');
});

test('an undefined error shows nothing', () => {
  setup({ error: undefined });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
