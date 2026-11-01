// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Runtime } from './runtime.js';

/**
 * Names of the objects one scenario (and worker) creates: every one starts with the run id, so
 * the teardown can find them, and carries the scenario `tag`, so parallel workers never clash.
 */
export function names(rt: Runtime, tag: string) {
  const site = (n: number) => ({
    key: `${rt.runId}-${tag}-s${n}`,
    name: `E2E ${rt.runId} ${tag} site ${n}`,
    host: `${rt.runId}-${tag}-s${n}.test`,
  });
  const email = (label: string) => `${rt.runId}-${tag}-${label}@e2e.example.com`;
  return {
    sites: [site(1), site(2), site(3)] as const,
    emails: {
      admin: email('admin'),
      userA: email('user-a'),
      userB: email('user-b'),
    },
  };
}
