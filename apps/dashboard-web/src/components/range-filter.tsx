// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { RangeSearch } from '../lib/range';
import { useRangeDraft } from '../lib/use-range-draft';
import { CustomRange, PresetSelect } from './range-filter-fields';

/** One row above the content it scopes. Presets first, a custom range behind "Custom range". */
export function RangeFilter({
  value,
  onChange,
}: Readonly<{
  value: RangeSearch;
  onChange: (next: RangeSearch) => void;
}>) {
  const { selected, resolved, from, to, problem, pick, edit } = useRangeDraft(value, onChange);
  return (
    <fieldset className="flex min-w-0 flex-wrap items-end gap-3">
      <legend className="sr-only">Date range</legend>
      <PresetSelect selected={selected} onPick={pick} />
      {selected === 'custom' ? (
        <CustomRange from={from} to={to} problem={problem} onEdit={edit} />
      ) : (
        <p className="pb-2 text-sm text-muted-foreground">
          {resolved.from} to {resolved.to} (UTC)
        </p>
      )}
    </fieldset>
  );
}
