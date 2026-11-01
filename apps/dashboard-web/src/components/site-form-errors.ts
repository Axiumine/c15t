// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Path } from 'react-hook-form';
import { ApiError, fieldIssues } from '../api';
import type { SiteFormInput } from './site-form-schema';

export type FieldName = Path<SiteFormInput>;
const FIELDS: readonly FieldName[] = ['key', 'name', 'domains', 'policyPreset'];

function fieldOf(path: string): FieldName | undefined {
  const root = path.split('.')[0];
  return FIELDS.find((name) => name === root);
}

/** Server-side rejections that belong to one field of this form. */
export function serverFieldErrors(error: unknown): [FieldName, string][] {
  if (error instanceof ApiError && error.code === 'SITE_KEY_TAKEN') {
    return [['key', 'This site key is already in use']];
  }
  return fieldIssues(error).flatMap((issue): [FieldName, string][] => {
    const name = fieldOf(issue.path);
    return name === undefined ? [] : [[name, issue.message]];
  });
}
