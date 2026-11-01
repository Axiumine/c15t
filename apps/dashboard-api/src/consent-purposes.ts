// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { fieldOf } from '@consent/shared';

/** c15t 2.x wrapped JSON columns as `{ json: ... }`. Unwrap it, and decode double-encoded text. */
function unwrapJson(value: unknown): unknown {
  let current = value;
  if (typeof current === 'string') {
    try {
      current = JSON.parse(current);
    } catch {
      return undefined;
    }
  }
  if (
    typeof current === 'object' &&
    current !== null &&
    !Array.isArray(current) &&
    'json' in current
  ) {
    return unwrapJson(current.json);
  }
  return current;
}

function receiptPurposes(choice: unknown): [string, boolean][] {
  const categories = fieldOf(unwrapJson(choice), 'categories');
  if (typeof categories !== 'object' || categories === null) return [];
  const entries: [string, boolean][] = [];
  for (const name of Object.keys(categories)) {
    const granted = fieldOf(fieldOf(categories, name), 'value');
    if (typeof granted === 'boolean') entries.push([name, granted]);
  }
  return entries;
}

function grantedCodes(purposeIds: unknown, codesById: ReadonlyMap<string, string>): string[] {
  const ids = unwrapJson(purposeIds);
  if (!Array.isArray(ids)) return [];
  const list: readonly unknown[] = ids;
  return list.flatMap((id) => {
    const code = typeof id === 'string' ? codesById.get(id) : undefined;
    return code === undefined ? [] : [code];
  });
}

/**
 * Category code to granted. `choice` (c15t 3.x receipts) says what was granted and what was
 * denied. Older rows only list the granted purpose IDs, which map to codes through `consentPurpose`.
 */
export function derivePurposes(
  choice: unknown,
  purposeIds: unknown,
  codesById: ReadonlyMap<string, string>,
): Record<string, boolean> {
  const purposes = new Map(receiptPurposes(choice));
  for (const code of grantedCodes(purposeIds, codesById)) {
    if (!purposes.has(code)) purposes.set(code, true);
  }
  return Object.fromEntries(purposes);
}
