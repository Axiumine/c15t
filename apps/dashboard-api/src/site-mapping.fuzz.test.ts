// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import * as fc from 'fast-check';
import { expect, test } from 'vitest';
import { siteSetup } from './site-mapping.js';

/*
 * The Setup screen prints the nginx tenant mapping. An admin pastes it into a vhost, so for every
 * valid site key it has to stay exactly two directives and carry nothing but the key.
 */

const RUNS = { numRuns: 300 };
const siteKey = fc.stringMatching(/^[a-z0-9-]{3,40}$/);

test('the nginx mapping is two directives and the key appears only as the tenant value', () => {
  fc.assert(
    fc.property(siteKey, (key) => {
      const { nginx } = siteSetup(key);
      expect(nginx.split('\n')).toEqual([`set $c15t_site ${key};`, 'include snippets/c15t.conf;']);
      expect(nginx.match(/;/g)).toHaveLength(2);
    }),
    RUNS,
  );
});

test('the key is never printed outside the nginx line and the server URL', () => {
  fc.assert(
    fc.property(siteKey, (key) => {
      const { backendUrl, scriptTag, serverClient } = siteSetup(key);
      // The browser never sees the site key (CLAUDE.md "Multi-tenancy").
      expect(backendUrl).toBe('/api/c15t');
      // Not `not.toContain(key)`: a short key such as "-cf" is a substring of the constant tag.
      expect(scriptTag).toBe(siteSetup('another-site').scriptTag);
      expect(serverClient).toContain(`/s/${key}\``);
    }),
    RUNS,
  );
});
