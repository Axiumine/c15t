// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Site } from '@consent/shared';

export type SiteAction =
  | { kind: 'create' }
  | { kind: 'edit'; site: Site }
  | { kind: 'status'; site: Site };
