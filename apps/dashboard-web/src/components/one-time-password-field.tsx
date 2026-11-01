// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { CopyButton } from './copy-button';
import { Input } from './ui/input';
import { Label } from './ui/label';

/** The password in a read-only field that selects itself on focus, next to a copy button. */
export function OneTimePasswordField({ password }: Readonly<{ password: string }>) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="one-time-password">One-time password</Label>
      <div className="flex gap-2">
        <Input
          id="one-time-password"
          readOnly
          value={password}
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
          onFocus={(event) => event.currentTarget.select()}
        />
        <CopyButton text={password} label="Copy password" />
      </div>
    </div>
  );
}
