// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { z } from 'zod';

type Issue = z.core.$ZodRawIssue;
type IssueOf<Code extends Issue['code']> = Extract<Issue, { code: Code }>;

function tooSmallMessage(issue: IssueOf<'too_small'>): string | undefined {
  if (issue.origin === 'array') return 'Add at least one item';
  if (issue.origin !== 'string') return undefined;
  return issue.minimum === 1 || issue.minimum === 1n
    ? 'This field is required'
    : `Must be at least ${issue.minimum} characters`;
}

function tooBigMessage(issue: IssueOf<'too_big'>): string | undefined {
  return issue.origin === 'string' ? `Must be at most ${issue.maximum} characters` : undefined;
}

function formatMessage(issue: IssueOf<'invalid_format'>): string | undefined {
  if (issue.format === 'email') return 'Enter a valid email address';
  return issue.format === 'regex' ? 'This value has an invalid format' : undefined;
}

function readableMessage(issue: Issue): string | undefined {
  switch (issue.code) {
    case 'too_small':
      return tooSmallMessage(issue);
    case 'too_big':
      return tooBigMessage(issue);
    case 'invalid_format':
      return formatMessage(issue);
    case 'invalid_value':
      return 'Choose one of the listed options';
    case 'invalid_type':
      return 'This field is required';
    default:
      return undefined;
  }
}

/*
 * Browser-side zod configuration, loaded once at startup (and by the test setup).
 * - jitless: zod would otherwise probe `new Function`, which the dashboard CSP forbids and
 *   reports as a violation. The interpreted path is just as correct and fast enough for forms.
 * - customError: readable form messages for the shared schemas, whose rules stay untouched.
 */
z.config({
  jitless: true,
  customError: readableMessage,
});
