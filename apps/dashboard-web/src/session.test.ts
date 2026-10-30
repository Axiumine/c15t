// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { expect, test } from 'vitest';
import { safeRedirectPath } from './session';

test('only same-origin paths are accepted as a post-login target', () => {
  expect(safeRedirectPath('/sites/shop?range=7d')).toBe('/sites/shop?range=7d');
  expect(safeRedirectPath(undefined)).toBeUndefined();
  expect(safeRedirectPath('https://evil.example')).toBeUndefined();
  expect(safeRedirectPath('//evil.example')).toBeUndefined();
  expect(safeRedirectPath('/\\evil.example')).toBeUndefined();
  expect(safeRedirectPath('javascript:alert(1)')).toBeUndefined();
  expect(safeRedirectPath('/login?redirect=/sites')).toBeUndefined();
});
