// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { act, renderHook } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { expect, test, vi } from 'vitest';
import { useReducedMotion } from './use-reduced-motion';

/** A MediaQueryList whose match state tests can flip, notifying whoever subscribed. */
function fakeMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const media = {
    matches: initial,
    addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
  };
  return {
    media,
    listeners,
    flip(next: boolean) {
      media.matches = next;
      for (const listener of listeners) listener();
    },
  };
}

test('follows prefers-reduced-motion live and unsubscribes on unmount', () => {
  const fake = fakeMedia(false);
  const matchMedia = vi.fn(() => fake.media);
  vi.stubGlobal('matchMedia', matchMedia);

  const { result, unmount } = renderHook(() => useReducedMotion());
  expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
  expect(result.current).toBe(false);
  expect(fake.listeners.size).toBe(1);

  act(() => fake.flip(true));
  expect(result.current).toBe(true);

  unmount();
  expect(fake.media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  expect(fake.listeners.size).toBe(0);
});

test('starts reduced when the preference is already set', () => {
  vi.stubGlobal('matchMedia', () => fakeMedia(true).media);
  const { result } = renderHook(() => useReducedMotion());
  expect(result.current).toBe(true);
});

test('without matchMedia the motion stays on and nothing throws', () => {
  vi.stubGlobal('matchMedia', undefined);
  const { result, unmount } = renderHook(() => useReducedMotion());
  expect(result.current).toBe(false);
  expect(() => unmount()).not.toThrow();
});

function Probe() {
  return <p>{String(useReducedMotion())}</p>;
}

test('the server render assumes motion is allowed', () => {
  vi.stubGlobal('matchMedia', () => fakeMedia(true).media);
  expect(renderToString(<Probe />)).toContain('false');
});
