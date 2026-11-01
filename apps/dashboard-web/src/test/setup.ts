// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import '../lib/zod-setup';

/** Gives every observed element a fixed size, so Recharts lays out inside jsdom. */
class FixedResizeObserver {
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    const entry = {
      target,
      contentRect: {
        width: 600,
        height: 300,
        top: 0,
        left: 0,
        right: 600,
        bottom: 300,
        x: 0,
        y: 0,
      },
    } as ResizeObserverEntry;
    queueMicrotask(() => this.callback([entry], this));
  }

  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = FixedResizeObserver;

// Radix and Recharts read these in jsdom; the browser has them natively.
Element.prototype.scrollIntoView = () => undefined;
window.scrollTo = () => undefined;
Element.prototype.hasPointerCapture = () => false;
Element.prototype.releasePointerCapture = () => undefined;

/** jsdom has no `matchMedia`; the members the app uses are enough for the stand-in. */
type MediaStandIn = Pick<
  MediaQueryList,
  'matches' | 'media' | 'onchange' | 'addEventListener' | 'removeEventListener' | 'dispatchEvent'
>;
const env: { matchMedia?: (query: string) => MediaStandIn } = globalThis;
env.matchMedia ??= (query) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => false,
});

afterEach(() => {
  cleanup();
});
