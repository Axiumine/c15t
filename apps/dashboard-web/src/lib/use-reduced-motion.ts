// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void): () => void {
  const media = globalThis.matchMedia?.(QUERY);
  media?.addEventListener('change', onChange);
  return () => media?.removeEventListener('change', onChange);
}

/** Recharts animates in JavaScript, so CSS alone cannot honour the preference. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => globalThis.matchMedia?.(QUERY).matches ?? false,
    () => false,
  );
}
