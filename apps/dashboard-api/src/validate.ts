// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Issue } from '@consent/shared';
import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import type { z } from 'zod';
import { HttpError } from './errors.js';

/** Field errors without the submitted values (they may be passwords). */
function issuesOf(error: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}): Issue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

/** `@hono/zod-validator` with the platform error format: `{ error: { code, message, issues } }`. */
export function validate<Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      throw new HttpError('VALIDATION_ERROR', 'The request is invalid', issuesOf(result.error));
    }
  });
}
