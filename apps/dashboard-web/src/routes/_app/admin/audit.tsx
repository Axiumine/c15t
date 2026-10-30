// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { createFileRoute } from '@tanstack/react-router';
import { AdminAuditScreen } from '../../../screens/admin/audit';

export const Route = createFileRoute('/_app/admin/audit')({ component: AdminAuditScreen });
