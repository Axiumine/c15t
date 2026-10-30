// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { QueryClientProvider } from '@tanstack/react-query';
import { type RouterHistory, RouterProvider } from '@tanstack/react-router';
import { createQueryClient, queryKeys } from './api';
import { type AppRouter, createAppRouter } from './router';
import { safeRedirectPath } from './session';

/**
 * Wires the query client and the router to each other: a 401 anywhere sends the user to the
 * login screen (remembering where they were), and a PASSWORD_CHANGE_REQUIRED answer sends
 * them to the forced change-password screen.
 */
export function createApp(history?: RouterHistory) {
  let router: AppRouter | undefined;
  const queryClient = createQueryClient({
    onUnauthorized: () => {
      // A route guard that is mid-navigation does its own redirect (see requireUser).
      if (router === undefined || router.state.status === 'pending') return;
      if (router.latestLocation.pathname === '/login') return;
      const redirect = safeRedirectPath(router.latestLocation.href);
      void router
        .navigate({ to: '/login', search: { redirect }, replace: true })
        .then(() => queryClient.clear());
    },
    onPasswordChangeRequired: () => {
      if (router === undefined || router.state.status === 'pending') return;
      if (router.latestLocation.pathname === '/account') return;
      queryClient.removeQueries({ queryKey: queryKeys.me });
      void router.navigate({ to: '/account', replace: true });
    },
  });
  router = createAppRouter(queryClient, history);
  return { queryClient, router };
}

export type App = ReturnType<typeof createApp>;

export function AppProviders({ app }: { app: App }) {
  return (
    <QueryClientProvider client={app.queryClient}>
      <RouterProvider router={app.router} />
    </QueryClientProvider>
  );
}
