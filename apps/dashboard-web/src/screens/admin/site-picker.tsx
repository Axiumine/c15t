// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Site } from '@consent/shared';
import { Checkbox } from '../../components/ui/input';
import { Label } from '../../components/ui/label';

export function SitePicker({
  sites,
  value,
  onChange,
}: Readonly<{
  sites: readonly Site[];
  value: readonly string[];
  onChange: (next: string[]) => void;
}>) {
  if (sites.length === 0) {
    return <p className="text-sm text-muted-foreground">No sites exist yet.</p>;
  }
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">Assigned sites</legend>
      <div className="grid max-h-48 gap-1.5 overflow-y-auto rounded-md border p-3">
        {sites.map((site) => {
          const id = `site-pick-${site.key}`;
          return (
            <div key={site.key} className="flex items-center gap-2">
              <Checkbox
                id={id}
                checked={value.includes(site.key)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...value, site.key]
                      : value.filter((key) => key !== site.key),
                  )
                }
              />
              <Label htmlFor={id} className="font-normal">
                {site.name}{' '}
                <span className="font-mono text-xs text-muted-foreground">{site.key}</span>
                {site.status === 'disabled' ? (
                  <span className="text-xs text-muted-foreground"> (disabled)</span>
                ) : null}
              </Label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
