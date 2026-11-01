// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { RANGE_PRESETS } from '../lib/range';
import { Field, fieldProps } from './form-field';
import { Input, Select } from './ui/input';

/** The editable from/to pair behind "Custom range". */
export function CustomRange({
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

export function PresetSelect({
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
