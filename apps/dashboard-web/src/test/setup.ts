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
    queueMicrotask(() => this.callback([entry], this as unknown as ResizeObserver));
  }

  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = FixedResizeObserver as unknown as typeof ResizeObserver;

// Radix and Recharts read these in jsdom; the browser has them natively.
Element.prototype.scrollIntoView = () => undefined;
window.scrollTo = () => undefined;
Element.prototype.hasPointerCapture = () => false;
Element.prototype.releasePointerCapture = () => undefined;
globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  dispatchEvent: () => false,
})) as typeof globalThis.matchMedia;

afterEach(() => {
  cleanup();
});
