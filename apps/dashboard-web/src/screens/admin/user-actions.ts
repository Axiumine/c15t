// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { UserSummary } from '@consent/shared';

export type UserAction = 'edit' | 'sites' | 'ban' | 'unban' | 'reset' | 'revoke';

export interface Pending {
  readonly kind: UserAction;
  readonly user: UserSummary;
}
