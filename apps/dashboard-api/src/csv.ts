// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

/*
 * RFC 4180 CSV. Consent rows carry visitor-controlled text (user agent, external ID), which an
 * admin opens in a spreadsheet. A cell that starts with a formula character gets a leading
 * apostrophe so the spreadsheet shows it as text instead of running it (CSV injection).
 */

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]/;

export type CsvValue = string | number | boolean | null | undefined;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : String(value);
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function csvRow(values: readonly CsvValue[]): string {
  return `${values.map(csvCell).join(',')}\r\n`;
}
