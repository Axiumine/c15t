// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

/*
 * Makes a JSON response comparable with a committed snapshot. Random ids, run prefixes, client
 * addresses and "now" timestamps are replaced by fixed labels, so a snapshot changes only when the
 * SHAPE or the stable content of an answer changes. Anything not named here is kept as it is, so a
 * new field, a renamed field or a changed message shows up in the diff.
 */

export interface NormalizeRules {
  /** Exact text to replace inside every string, e.g. the run prefix or a user id. Longest first. */
  readonly literals: ReadonlyMap<string, string>;
  /** Keys whose string value is replaced by the label, whatever it is (opaque cursors, addresses). */
  readonly opaqueKeys?: ReadonlyMap<string, string>;
  /** Keys whose ISO date-time value is volatile (the row was created "now"). */
  readonly volatileTimeKeys?: readonly string[];
}

function isIsoDateTime(text: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/.test(text) && !Number.isNaN(Date.parse(text));
}

function replaceLiterals(text: string, literals: ReadonlyMap<string, string>): string {
  let result = text;
  for (const [literal, label] of [...literals].sort((a, b) => b[0].length - a[0].length)) {
    result = result.replaceAll(literal, label);
  }
  return result;
}

function normalizeString(text: string, rules: NormalizeRules, key: string | undefined): string {
  if (key === undefined) return replaceLiterals(text, rules.literals);
  const opaque = rules.opaqueKeys?.get(key);
  if (opaque !== undefined) return opaque;
  if (rules.volatileTimeKeys?.includes(key) === true && isIsoDateTime(text)) return '<timestamp>';
  return replaceLiterals(text, rules.literals);
}

/** `Array.isArray` narrows `unknown` to `any[]`; this keeps the elements `unknown`. */
const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);

export function normalize(value: unknown, rules: NormalizeRules, key?: string): unknown {
  if (typeof value === 'string') return normalizeString(value, rules, key);
  if (isList(value)) return value.map((item) => normalize(item, rules, key));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([name, inner]: [string, unknown]) => [
        replaceLiterals(name, rules.literals),
        normalize(inner, rules, name),
      ]),
    );
  }
  return value;
}

const LINE_END_LABEL = new Map([
  ['\r\n', '<CRLF>\n'],
  ['\r', '<CR>'],
  ['\n', '<LF>'],
]);

/**
 * A CSV with its line ends made visible, so a snapshot shows (and a diff catches) CRLF versus LF
 * and a line break inside a quoted cell. Git and editors may rewrite the invisible characters.
 */
export function visibleLineEnds(csv: string): string {
  return csv.replace(/\r\n|\r|\n/g, (end) => LINE_END_LABEL.get(end) ?? end);
}
