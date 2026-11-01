// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { OneTimeSecret } from '../api/user-writes';
import { OneTimePasswordField } from './one-time-password-field';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

export function OneTimePasswordDialog({
  secret,
  onClose,
}: Readonly<{
  secret: OneTimeSecret | null;
  onClose: () => void;
}>) {
  return (
    <Dialog open={secret !== null}>
      <DialogContent dismissible={false}>
        {secret === null ? null : (
          <>
            <DialogHeader>
              <DialogTitle>
                {secret.reason === 'created' ? 'User created' : 'Password reset'}
              </DialogTitle>
              <DialogDescription>
                One-time password for {secret.email}. It is shown only now and cannot be retrieved
                later. Hand it over through a secure channel. The user must change it at the first
                sign-in.
              </DialogDescription>
            </DialogHeader>
            <OneTimePasswordField password={secret.password} />
            <DialogFooter>
              <Button type="button" onClick={onClose}>
                I have stored the password
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
