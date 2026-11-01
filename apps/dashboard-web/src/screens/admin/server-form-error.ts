// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { ApiError, errorMessage, fieldIssues } from '../../api';

export function serverFormError(
  error: unknown,
  emailField: boolean,
): { email?: string; message?: string } {
  if (emailField && error instanceof ApiError && error.code === 'EMAIL_TAKEN') {
    return { email: 'A user with this email already exists' };
  }
  const issues = fieldIssues(error);
  const first = issues[0];
  return { message: first === undefined ? errorMessage(error) : first.message };
}
