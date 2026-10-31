// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, useState } from 'react';
import { expect, test, vi } from 'vitest';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';

/** Opened from state, like every dialog in the app, so Radix has no trigger to focus afterwards. */
function Harness({
  dismissible,
  remove = false,
  children,
}: {
  dismissible?: boolean;
  remove?: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [present, setPresent] = useState(true);
  return (
    <>
      {present ? (
        <button type="button" onClick={() => setOpen(true)}>
          Open
        </button>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent {...(dismissible === undefined ? {} : { dismissible })}>
          <DialogHeader className="extra-header">
            <DialogTitle className="extra-title">Heading</DialogTitle>
            <DialogDescription className="extra-description">Details</DialogDescription>
          </DialogHeader>
          {children}
          <DialogFooter className="extra-footer">
            <DialogClose asChild>
              <button type="button">Done</button>
            </DialogClose>
            {remove ? (
              <button type="button" onClick={() => setPresent(false)}>
                Remove opener
              </button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

test('wires title, description and the extra class names', async () => {
  render(<Harness />);
  await userEvent.click(screen.getByRole('button', { name: 'Open' }));
  const dialog = await screen.findByRole('dialog', { name: 'Heading' });
  expect(dialog).toHaveAccessibleDescription('Details');
  expect(screen.getByText('Heading')).toHaveClass('extra-title');
  expect(screen.getByText('Details')).toHaveClass('extra-description');
  expect(screen.getByText('Heading').parentElement).toHaveClass('extra-header');
  expect(screen.getByRole('button', { name: 'Done' }).parentElement).toHaveClass('extra-footer');
});

test('a normal dialog has a close button and closes on Escape, handing focus back to the opener', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const opener = screen.getByRole('button', { name: 'Open' });
  await user.click(opener);
  await screen.findByRole('dialog');
  expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();

  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(opener).toHaveFocus();
});

test('the close button also returns focus to the opener', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const opener = screen.getByRole('button', { name: 'Open' });
  await user.click(opener);
  await user.click(await screen.findByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(opener).toHaveFocus();
});

test('a non-dismissible dialog ignores Escape and outside clicks and has no close button', async () => {
  const user = userEvent.setup();
  render(<Harness dismissible={false} />);
  await user.click(screen.getByRole('button', { name: 'Open' }));
  await screen.findByRole('dialog');
  expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();

  await user.keyboard('{Escape}');
  expect(screen.getByRole('dialog')).toBeInTheDocument();

  // The overlay sits outside the content; pressing it must not dismiss either.
  const overlay = document.querySelector('.overlay-motion');
  expect(overlay).not.toBeNull();
  await user.pointer({ keys: '[MouseLeft]', target: overlay as Element });
  expect(screen.getByRole('dialog')).toBeInTheDocument();

  // Only the explicit button closes it.
  await user.click(screen.getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

function WithHandler({ onEscapeKeyDown }: { onEscapeKeyDown: (event: KeyboardEvent) => void }) {
  return (
    <Dialog open>
      <DialogContent onEscapeKeyDown={onEscapeKeyDown}>
        <DialogTitle>Heading</DialogTitle>
        <DialogDescription>Details</DialogDescription>
      </DialogContent>
    </Dialog>
  );
}

test('props meant for Radix content still reach it', async () => {
  const onEscapeKeyDown = vi.fn();
  render(<WithHandler onEscapeKeyDown={onEscapeKeyDown} />);
  await screen.findByRole('dialog');
  await userEvent.keyboard('{Escape}');
  expect(onEscapeKeyDown).toHaveBeenCalledTimes(1);
});

test('when the opener is gone, focus is left to Radix instead of a detached element', async () => {
  const user = userEvent.setup();
  render(<Harness remove />);
  await user.click(screen.getByRole('button', { name: 'Open' }));
  await screen.findByRole('dialog');
  await user.click(screen.getByRole('button', { name: 'Remove opener' }));
  await user.click(screen.getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
  expect(document.body).toHaveFocus();
});

test('with no focused element when the dialog opens, there is nothing to hand focus back to', async () => {
  const user = userEvent.setup();
  const active = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(null);
  render(<Harness />);
  await user.click(screen.getByRole('button', { name: 'Open' }));
  await screen.findByRole('dialog');
  await user.click(screen.getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  active.mockRestore();
  expect(screen.getByRole('button', { name: 'Open' })).not.toHaveFocus();
});
