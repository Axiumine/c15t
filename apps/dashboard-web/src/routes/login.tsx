// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { LoginScreen } from '../screens/login';
import { currentUser } from '../session';

export const Route = createFileRoute('/login')({
  validateSearch: z.object({ redirect: z.string().max(2048).optional().catch(undefined) }),
  beforeLoad: async ({ context }) => {
    // Already signed in: skip the form.
    const me = await currentUser(context.queryClient, { fresh: true });
    if (me !== null) throw redirect({ to: me.mustChangePassword ? '/account' : '/sites' });
  },
  component: LoginRoute,
});

function LoginRoute() {
  const { redirect: redirectTo } = Route.useSearch();
  return <LoginScreen redirectTo={redirectTo} />;
}
