// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/** `matchMedia` is missing in some runtimes (server rendering, bare test environments). */
const env: { readonly matchMedia?: (query: string) => MediaQueryList } = globalThis;

function subscribe(onChange: () => void): () => void {
  const media = env.matchMedia?.(QUERY);
  media?.addEventListener('change', onChange);
  return () => media?.removeEventListener('change', onChange);
}

/** Recharts animates in JavaScript, so CSS alone cannot honour the preference. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => env.matchMedia?.(QUERY).matches ?? false,
    () => false,
  );
}
