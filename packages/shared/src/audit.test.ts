// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { describe, expect, test } from 'vitest';
import {
  AUDIT_ACTIONS,
  auditActionSchema,
  auditEntrySchema,
  auditListQuerySchema,
  auditPageSchema,
} from './audit.js';

const entry = {
  id: 'a1',
  actorId: 'u1',
  actorEmail: 'admin@example.com',
  action: 'site.create',
  targetType: 'site',
  targetId: 'shop',
  metadata: { domains: ['shop.example.com'] },
  ip: '203.0.113.7',
  createdAt: '2026-10-30T12:00:00.000Z',
};

describe('audit contract', () => {
  test('actions are dotted and validated', () => {
    for (const action of AUDIT_ACTIONS) expect(action).toMatch(/^(site|user)\.[a-z-]+$/);
    expect(auditActionSchema.safeParse('site.delete').success).toBe(false);
  });

  test('entries and pages parse', () => {
    expect(auditEntrySchema.safeParse(entry).success).toBe(true);
    expect(auditEntrySchema.safeParse({ ...entry, actorId: null, ip: null }).success).toBe(true);
    expect(auditEntrySchema.safeParse({ ...entry, targetType: 'consent' }).success).toBe(false);
    expect(auditPageSchema.safeParse({ items: [entry], nextCursor: null }).success).toBe(true);
  });

  test('list query reuses cursor paging', () => {
    expect(auditListQuerySchema.parse({ limit: '5' })).toEqual({ limit: 5 });
  });
});
