// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Site } from '@consent/shared';
import { useUpdateSite } from '../../api';
import { ConfirmDialog } from '../../components/confirm-dialog';

export function StatusDialog({
  site,
  onClose,
}: Readonly<{ site: Site | null; onClose: () => void }>) {
  const update = useUpdateSite();
  const disabling = site?.status === 'active';
  const name = site?.name ?? '';
  const confirm =
    site === null
      ? undefined
      : () =>
          update.mutate(
            { siteKey: site.key, changes: { status: disabling ? 'disabled' : 'active' } },
            { onSuccess: onClose },
          );
  return (
    <ConfirmDialog
      open={site !== null}
      onOpenChange={() => {
        update.reset();
        onClose();
      }}
      title={disabling ? `Disable ${name}?` : `Enable ${name}?`}
      description={
        disabling
          ? 'The site stops serving its banner and consent requests. Its records are kept. You can enable it again at any time.'
          : 'The site starts serving its banner and consent requests again.'
      }
      confirmLabel={disabling ? 'Disable site' : 'Enable site'}
      destructive={disabling}
      pending={update.isPending}
      error={update.error}
      onConfirm={() => confirm?.()}
    />
  );
}
