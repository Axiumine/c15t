// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { z } from 'zod';
import { parseCidr } from './ip.js';

/*
 * Schemas for the network settings of the env files (ports, CIDR lists). The IP parsing behind
 * them is browser-safe (no `node:net`), because @consent/shared is also bundled by dashboard-web.
 */

/** TCP port from 1024 to 65535. Accepts a number or a decimal string (env values are strings). */
export const portSchema = z
  .union([
    z.number(),
    z
      .string()
      .trim()
      .regex(/^\d{1,5}$/, 'Port must be a decimal integer'),
  ])
  .transform((value) => Number(value))
  .pipe(z.number().int().min(1024, 'Port must be 1024 or higher').max(65535));

/** One IPv4 or IPv6 CIDR such as `127.0.0.1/32` or `::1/128`. */
export const cidrSchema = z
  .string()
  .trim()
  .refine((value) => parseCidr(value) !== null, 'Must be a CIDR such as 10.0.0.0/8 or fd00::/8');

/** Comma-separated CIDR list (for `CONSENT_API_TRUSTED_PROXIES`) parsed into an array. */
export const cidrListSchema = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== ''),
  )
  .pipe(z.array(cidrSchema).min(1, 'At least one CIDR is required'));
