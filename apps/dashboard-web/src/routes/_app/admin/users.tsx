// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { createFileRoute } from '@tanstack/react-router';
import { AdminUsersScreen } from '../../../screens/admin/users';

export const Route = createFileRoute('/_app/admin/users')({ component: AdminUsersScreen });
