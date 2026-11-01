// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { useCallback, useState } from 'react';
import type { OneTimeSecret } from '../api';
import { CopyButton } from './copy-button';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';

/**
 * Holds a one-time password in component state only: it never enters the Query cache. Closing
 * the dialog clears it, and the API cannot show it again (README D5).
 */
export function useOneTimeSecret() {
  const [secret, setSecret] = useState<OneTimeSecret | null>(null);
  const clear = useCallback(() => setSecret(null), []);
  return { secret, reveal: setSecret, clear };
}

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
            <div className="grid gap-1.5">
              <Label htmlFor="one-time-password">One-time password</Label>
              <div className="flex gap-2">
                <Input
                  id="one-time-password"
                  readOnly
                  value={secret.password}
                  className="font-mono"
                  autoComplete="off"
                  spellCheck={false}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <CopyButton text={secret.password} label="Copy password" />
              </div>
            </div>
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
