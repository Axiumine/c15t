// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { z } from 'zod';

/** Web origin without a path, e.g. `https://dashboard.example.com`. Used for BETTER_AUTH_URL. */
export const originSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const message = 'Must be an http(s) origin without path, query or credentials';
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: 'custom', message });
      return z.NEVER;
    }
    const plain =
      url.pathname === '/' && url.search === '' && url.hash === '' && url.username === '';
    if (!['http:', 'https:'].includes(url.protocol) || !plain) {
      ctx.addIssue({ code: 'custom', message });
      return z.NEVER;
    }
    return url.origin;
  });
