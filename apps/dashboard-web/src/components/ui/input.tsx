// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { ComponentProps } from 'react';
import { cn } from '../../lib/cn';

const control =
  'w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm text-card-foreground shadow-xs placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(control, 'h-9 py-1', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(control, 'min-h-20 py-2', className)} {...props} />;
}

/** A native select: always keyboard and screen-reader friendly, and no popover to test around. */
export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select className={cn(control, 'h-9 py-1', className)} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="checkbox"
      className={cn('size-4 shrink-0 rounded-sm border-input accent-primary', className)}
      {...props}
    />
  );
}
