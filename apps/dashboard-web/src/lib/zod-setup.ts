// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { z } from 'zod';

/*
 * Browser-side zod configuration, loaded once at startup (and by the test setup).
 * - jitless: zod would otherwise probe `new Function`, which the dashboard CSP forbids and
 *   reports as a violation. The interpreted path is just as correct and fast enough for forms.
 * - customError: readable form messages for the shared schemas, whose rules stay untouched.
 */
z.config({
  jitless: true,
  customError: (issue) => {
    if (issue.code === 'too_small' && issue.origin === 'string') {
      return issue.minimum === 1 || issue.minimum === 1n
        ? 'This field is required'
        : `Must be at least ${issue.minimum} characters`;
    }
    if (issue.code === 'too_big' && issue.origin === 'string') {
      return `Must be at most ${issue.maximum} characters`;
    }
    if (issue.code === 'too_small' && issue.origin === 'array') {
      return 'Add at least one item';
    }
    if (issue.code === 'invalid_format' && issue.format === 'email') {
      return 'Enter a valid email address';
    }
    if (issue.code === 'invalid_format' && issue.format === 'regex') {
      return 'This value has an invalid format';
    }
    if (issue.code === 'invalid_value') return 'Choose one of the listed options';
    if (issue.code === 'invalid_type') return 'This field is required';
    return undefined;
  },
});
