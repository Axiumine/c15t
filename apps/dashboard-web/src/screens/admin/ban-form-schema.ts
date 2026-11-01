// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { banUserSchema } from '@consent/shared';
import { z } from 'zod';

export const BAN_DURATIONS = [
  { value: '', label: 'Until an administrator lifts it' },
  { value: String(24 * 3600), label: '1 day' },
  { value: String(7 * 24 * 3600), label: '7 days' },
  { value: String(30 * 24 * 3600), label: '30 days' },
] as const;

export const banFormSchema = z
  .object({ reason: z.string(), duration: z.string() })
  .transform(
    ({ reason, duration }): z.input<typeof banUserSchema> => ({
      ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
      ...(duration === '' ? {} : { expiresInSeconds: Number(duration) }),
    }),
  )
  .pipe(banUserSchema);
