// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { createFileRoute } from '@tanstack/react-router';
import { SitesListScreen } from '../../../screens/sites-list';

export const Route = createFileRoute('/_app/sites/')({ component: SitesListScreen });
