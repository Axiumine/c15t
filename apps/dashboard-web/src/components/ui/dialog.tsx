// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { type ComponentProps, useRef } from 'react';
import { cn } from '../../lib/cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/**
 * Radix supplies the focus trap, Escape handling, aria wiring and focus return. `dismissible`
 * false is for dialogs that hold something that cannot be shown again (a one-time password):
 * only an explicit button closes them.
 */
export function DialogContent({
  className,
  children,
  dismissible = true,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { dismissible?: boolean }) {
  // Dialogs here are opened from state, not from a Radix trigger, so Radix has nothing to hand
  // focus back to. Remember the opener and return to it, or keyboard users land on <body>.
  const opener = useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="overlay-motion fixed inset-0 z-50 bg-black/60" />
      <DialogPrimitive.Content
        className={cn(
          'dialog-motion fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border bg-card p-5 text-card-foreground shadow-lg',
          className,
        )}
        onOpenAutoFocus={() => {
          opener.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          if (opener.current?.isConnected !== true) return;
          event.preventDefault();
          opener.current.focus();
        }}
        {...(dismissible
          ? {}
          : {
              onEscapeKeyDown: (event: KeyboardEvent) => event.preventDefault(),
              onInteractOutside: (event: Event) => event.preventDefault(),
            })}
        {...props}
      >
        {children}
        {dismissible ? (
          <DialogPrimitive.Close
            aria-label="Close"
            className="absolute top-3 right-3 rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" aria-hidden="true" />
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-1.5 pr-6', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-lg font-semibold leading-tight', className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}
