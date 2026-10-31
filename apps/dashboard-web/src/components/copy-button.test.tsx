// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CodeBlock, CopyButton } from './copy-button';

function stubClipboard(writeText: (text: string) => Promise<void>) {
  const spy = vi.fn(writeText);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: spy },
  });
  return spy;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'clipboard');
});

async function click(button: HTMLElement) {
  await act(async () => {
    fireEvent.click(button);
  });
}

test('copies the text, confirms it, and goes back to the label after a moment', async () => {
  const writeText = stubClipboard(() => Promise.resolve());
  render(<CopyButton text="secret-text" />);
  const button = screen.getByRole('button', { name: 'Copy' });

  await click(button);
  expect(writeText).toHaveBeenCalledWith('secret-text');
  expect(screen.getByRole('button', { name: /Copied/ })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Copied to the clipboard');

  await act(async () => {
    vi.advanceTimersByTime(2499);
  });
  expect(screen.getByRole('status')).toHaveTextContent('Copied to the clipboard');
  await act(async () => {
    vi.advanceTimersByTime(1);
  });
  expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
});

test('uses the label it is given', () => {
  stubClipboard(() => Promise.resolve());
  render(<CopyButton text="x" label="Copy password" />);
  expect(screen.getByRole('button', { name: 'Copy password' })).toBeInTheDocument();
});

test('a clipboard that refuses is reported, with the way out, and then resets', async () => {
  stubClipboard(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));
  render(<CopyButton text="x" />);

  await click(screen.getByRole('button', { name: 'Copy' }));
  expect(screen.getByRole('status')).toHaveTextContent(
    'Copy failed. Select the text and copy it by hand.',
  );
  expect(screen.queryByText('Copied')).not.toBeInTheDocument();

  await act(async () => {
    vi.advanceTimersByTime(2500);
  });
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
});

test('copying again restarts the reset timer instead of stacking timers', async () => {
  stubClipboard(() => Promise.resolve());
  render(<CopyButton text="x" />);
  const button = screen.getByRole('button', { name: 'Copy' });

  await click(button);
  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
  await click(screen.getByRole('button', { name: /Copied/ }));
  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
  // 4 s since the first click, but only 2 s since the second: still confirmed.
  expect(screen.getByRole('status')).toHaveTextContent('Copied to the clipboard');
  await act(async () => {
    vi.advanceTimersByTime(500);
  });
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
});

test('a pending reset is cancelled when the button goes away', async () => {
  stubClipboard(() => Promise.resolve());
  const { unmount } = render(<CopyButton text="x" />);
  await click(screen.getByRole('button', { name: 'Copy' }));
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

test('a code block names its region, shows the code and copies exactly that code', async () => {
  const writeText = stubClipboard(() => Promise.resolve());
  render(
    <CodeBlock title="Nginx snippet" code={'set $c15t_site shop;\ninclude snippets/c15t.conf;'} />,
  );

  expect(screen.getByRole('heading', { name: 'Nginx snippet' })).toBeInTheDocument();
  const region = screen.getByRole('region', { name: 'Nginx snippet' });
  expect(region).toHaveAttribute('tabindex', '0');
  expect(region).toHaveTextContent('set $c15t_site shop;');

  await click(screen.getByRole('button', { name: 'Copy nginx snippet' }));
  expect(writeText).toHaveBeenCalledWith('set $c15t_site shop;\ninclude snippets/c15t.conf;');
});
