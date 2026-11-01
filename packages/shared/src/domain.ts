// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { z } from 'zod';

const HOST_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const DOMAIN_PATTERN = new RegExp(`^${HOST_LABEL}(?:\\.${HOST_LABEL})*(?::[0-9]{1,5})?$`);

/**
 * A website host as the browser sends it: lowercase `host` or `host:port`, no scheme, path or
 * wildcard. It is both the `Host` allowlist entry and the c15t `trustedOrigins` entry (c15t
 * matches a hostname on any web scheme and pins a port when one is given).
 */
export const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .refine((value) => !value.includes('*'), 'Wildcards are not allowed')
  .refine((value) => DOMAIN_PATTERN.test(value), 'Must be a host name such as shop.example.com')
  .refine((value) => {
    const port = value.split(':')[1];
    return port === undefined || (Number(port) >= 1 && Number(port) <= 65535);
  }, 'Port must be between 1 and 65535');

export const MAX_DOMAINS_PER_SITE = 50;

/**
 * Non-empty, unique list of domains. An empty list or `*` must never reach c15t, so consent-api
 * validates its `trustedOrigins` (the same values) with this schema too.
 */
export const domainsSchema = z
  .array(domainSchema)
  .min(1, 'At least one domain is required')
  .max(MAX_DOMAINS_PER_SITE)
  .refine((list) => new Set(list).size === list.length, 'Domains must be unique');
export type Domains = z.infer<typeof domainsSchema>;
