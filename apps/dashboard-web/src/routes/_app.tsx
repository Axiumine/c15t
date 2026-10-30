// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { createFileRoute } from '@tanstack/react-router';
import { useMe } from '../api';
import { AppShell } from '../components/app-shell';
import { requireUser } from '../session';

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context, location }) => ({
    me: await requireUser(context.queryClient, location.pathname, location.href),
  }),
  component: AppLayout,
});

function AppLayout() {
  const initial = Route.useRouteContext({ select: (context) => context.me });
  // The query is the live copy; the route context only carries the value the guard saw.
  const live = useMe();
  return <AppShell me={live.data ?? initial} />;
}
