// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Site, UserSummary } from '@consent/shared';
import { useState } from 'react';
import { errorMessage } from '../../api';
import { useSetUserSites } from '../../api/user-writes';
import { FormError } from '../../components/form-field';
import { Button } from '../../components/ui/button';
import { DialogFooter } from '../../components/ui/dialog';
import { SitePicker } from './site-picker';

export function SitesForm({
  user,
  sites,
  onClose,
}: Readonly<{
  user: UserSummary;
  sites: readonly Site[];
  onClose: () => void;
}>) {
  const setSites = useSetUserSites();
  const [selected, setSelected] = useState<string[]>(user.siteKeys);
  return (
    <div className="grid gap-4">
      <FormError message={setSites.error === null ? undefined : errorMessage(setSites.error)} />
      <SitePicker sites={sites} value={selected} onChange={setSelected} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={setSites.isPending}
          onClick={() =>
            setSites.mutate({ id: user.id, siteKeys: selected }, { onSuccess: onClose })
          }
        >
          {setSites.isPending ? 'Saving…' : 'Save assignments'}
        </Button>
      </DialogFooter>
    </div>
  );
}
