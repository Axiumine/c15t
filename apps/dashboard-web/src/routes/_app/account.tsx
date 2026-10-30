// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { createFileRoute } from '@tanstack/react-router';
import { AccountScreen } from '../../screens/account';

export const Route = createFileRoute('/_app/account')({ component: AccountScreen });
