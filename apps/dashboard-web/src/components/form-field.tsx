// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { ReactNode } from 'react';
import { Label } from './ui/label';

interface FieldProps {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: ReactNode;
}

/** Wires label, hint and error text to a control through `fieldProps(id, error, hint)`. */
export function Field({ id, label, error, hint, children }: Readonly<FieldProps>) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint === undefined ? null : (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p id={`${id}-error`} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function fieldProps(id: string, error?: string, hint?: string) {
  const describedBy = [
    error === undefined ? '' : `${id}-error`,
    hint === undefined ? '' : `${id}-hint`,
  ]
    .filter((part) => part !== '')
    .join(' ');
  return {
    id,
    'aria-invalid': error === undefined ? undefined : (true as const),
    'aria-describedby': describedBy === '' ? undefined : describedBy,
  };
}

export function FormError({ message }: Readonly<{ message: string | undefined }>) {
  if (message === undefined) return null;
  return (
    <p role="alert" className="rounded-md border border-destructive px-3 py-2 text-sm">
      {message}
    </p>
  );
}
