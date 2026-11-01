// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { SITE_KEY_PATTERN } from '@consent/shared';

/*
 * Paths. The URL parser resolves `..` and decodes some escapes, so the check has to run on the
 * raw request target, before routing. nginx normalises paths already; this is the second wall.
 */

const UNSAFE_PATH = /\.\.|%2e|%2f|%5c|%25|%[01][0-9a-f]|%7f|\\|(?:^|\/)\.(?:\/|$)/i;

function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** The raw request target without query or fragment. Handles origin-form and absolute-form. */
export function rawPathname(target: string): string {
  let path = target;
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(path);
  if (scheme !== null) path = path.slice(scheme[0].length);
  const end = path.search(/[?#]/);
  return end === -1 ? path : path.slice(0, end);
}

export function isSafePath(target: string): boolean {
  const path = rawPathname(target);
  return path.startsWith('/') && !UNSAFE_PATH.test(path) && !hasControlCharacter(path);
}

// eslint-disable-next-line security/detect-non-literal-regexp -- built from the SITE_KEY_PATTERN constant, never from input
const SITE_PATH = new RegExp(`^/s/(${SITE_KEY_PATTERN.source.slice(1, -1)})(?=/|$)`);

/** The `siteKey` of `/s/<siteKey>/...`, read from the raw path so it matches what c15t will see. */
export function siteKeyFromPath(target: string): string | undefined {
  return SITE_PATH.exec(rawPathname(target))?.[1];
}
