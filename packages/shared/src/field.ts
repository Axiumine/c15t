// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

/**
 * `value[key]` for an object, `undefined` for anything else, typed `unknown` so the caller has to
 * check it. For data of an unknown shape (error objects, parsed JSON) instead of a type assertion.
 * `Reflect.get` is typed `any`, and the return type stops that here.
 */
export function fieldOf(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined;
}
