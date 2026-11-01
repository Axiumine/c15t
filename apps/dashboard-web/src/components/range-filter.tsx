// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { useState } from 'react';
import {
  DEFAULT_RANGE_PRESET,
  RANGE_PRESETS,
  type RangeSearch,
  resolveRange,
  validateCustomRange,
} from '../lib/range';
import { Field, fieldProps } from './form-field';
import { Input, Select } from './ui/input';

/** The editable from/to pair behind "Custom range". */
function CustomRange({
  from,
  to,
  problem,
  onEdit,
}: Readonly<{
  from: string;
  to: string;
  problem: string | undefined;
  onEdit: (nextFrom: string, nextTo: string) => void;
}>) {
  return (
    <>
      <Field id="range-from" label="From" error={problem}>
        <Input
          {...fieldProps('range-from', problem)}
          type="date"
          value={from}
          onChange={(event) => onEdit(event.target.value, to)}
          className="w-40"
        />
      </Field>
      <Field id="range-to" label="To (inclusive)">
        <Input
          id="range-to"
          type="date"
          value={to}
          onChange={(event) => onEdit(from, event.target.value)}
          className="w-40"
        />
      </Field>
    </>
  );
}

function PresetSelect({
  selected,
  onPick,
}: Readonly<{ selected: string; onPick: (next: string) => void }>) {
  return (
    <Field id="range-preset" label="Period">
      <Select
        id="range-preset"
        value={selected}
        onChange={(event) => onPick(event.target.value)}
        className="w-44"
      >
        {RANGE_PRESETS.map((preset) => (
          <option key={preset.value} value={preset.value}>
            {preset.label}
          </option>
        ))}
        <option value="custom">Custom range</option>
      </Select>
    </Field>
  );
}

/** One row above the content it scopes. Presets first, a custom range behind "Custom range". */
export function RangeFilter({
  value,
  onChange,
}: Readonly<{
  value: RangeSearch;
  onChange: (next: RangeSearch) => void;
}>) {
  const selected = value.range ?? DEFAULT_RANGE_PRESET;
  const resolved = resolveRange(value);
  const [from, setFrom] = useState(resolved.from);
  const [to, setTo] = useState(resolved.to);
  const problem = selected === 'custom' ? validateCustomRange(from, to) : undefined;

  function pick(next: string) {
    if (next === 'custom') {
      onChange({ range: 'custom', from: resolved.from, to: resolved.to });
      setFrom(resolved.from);
      setTo(resolved.to);
      return;
    }
    const preset = RANGE_PRESETS.find((item) => item.value === next);
    if (preset !== undefined) onChange({ range: preset.value });
  }

  function edit(nextFrom: string, nextTo: string) {
    setFrom(nextFrom);
    setTo(nextTo);
    if (validateCustomRange(nextFrom, nextTo) === undefined) {
      onChange({ range: 'custom', from: nextFrom, to: nextTo });
    }
  }

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
