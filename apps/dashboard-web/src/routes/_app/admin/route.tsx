// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

// UX only: the API answers 403 to a non-admin whatever the UI shows.
export const Route = createFileRoute('/_app/admin')({
  beforeLoad: ({ context }) => {
    if (context.me.role !== 'admin') throw redirect({ to: '/sites' });
  },
  component: Outlet,
});
