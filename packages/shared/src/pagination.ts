// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/** Opaque to clients. The server encodes whatever sort key it needs. */
export const cursorSchema = z.string().min(1).max(512);

/** Query string of every cursor-paginated list endpoint. */
export const pageQuerySchema = z.object({
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type PageQuery = z.output<typeof pageQuerySchema>;

/** `nextCursor` is null on the last page. */
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: cursorSchema.nullable(),
  });
}
export type Page<T> = { items: T[]; nextCursor: string | null };
