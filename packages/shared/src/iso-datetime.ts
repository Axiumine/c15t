// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { z } from 'zod';

/** An ISO 8601 timestamp with a UTC offset, as the dashboard API sends and reads it. */
export const isoDateTime = z.iso.datetime({ offset: true });
