// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { useState } from 'react';
import {
  DEFAULT_RANGE_PRESET,
  RANGE_PRESETS,
  type RangeSearch,
  resolveRange,
  validateCustomRange,
} from './range';

/**
 * The state behind the range filter: the selected period, the resolved dates and the draft
 * from/to pair of a custom range. A change reaches `onChange` only when it is valid.
 */
export function useRangeDraft(value: RangeSearch, onChange: (next: RangeSearch) => void) {
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

  return { selected, resolved, from, to, problem, pick, edit };
}
