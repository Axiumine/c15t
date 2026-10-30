// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  type ErrorComponentProps,
  Link,
  Outlet,
  useRouter,
} from '@tanstack/react-router';
import { EmptyState, ErrorState } from '../components/states';
import { Button } from '../components/ui/button';

export interface RouterContext {
  readonly queryClient: QueryClient;
}

function RootError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-xl p-6">
      <ErrorState
        error={error}
        onRetry={() => {
          reset();
          void router.invalidate();
        }}
      />
    </div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-xl p-6">
      <EmptyState
        title="Page not found"
        description="This page does not exist."
        action={
          <Button asChild variant="outline">
            <Link to="/sites">Go to sites</Link>
          </Button>
        }
      />
    </div>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  errorComponent: RootError,
  notFoundComponent: NotFound,
});
