// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { errorMessage, isUnavailable } from '../api';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';

export function LoadingBlock({ label = 'Loading' }: { label?: string }) {
  return (
    <output className="grid gap-3" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}…</span>
      <Skeleton className="h-6 w-1/3" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </output>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: (() => void) | undefined;
}) {
  const retryable = onRetry !== undefined;
  return (
    <Alert variant="destructive">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="grid flex-1 gap-2">
          <div>
            <AlertTitle>
              {isUnavailable(error) ? 'Temporarily unavailable' : 'Something went wrong'}
            </AlertTitle>
            <AlertDescription>{errorMessage(error)}</AlertDescription>
          </div>
          {retryable ? (
            <div>
              <Button type="button" size="sm" variant="outline" onClick={onRetry}>
                <RefreshCw aria-hidden="true" />
                Try again
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </Alert>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string | undefined;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center">
      <Inbox className="size-6 text-muted-foreground" aria-hidden="true" />
      <p className="font-medium">{title}</p>
      {description === undefined ? null : (
        <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
      )}
      {action}
    </div>
  );
}
