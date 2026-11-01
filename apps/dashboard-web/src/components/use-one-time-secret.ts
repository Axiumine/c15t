// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { useCallback, useState } from 'react';
import type { OneTimeSecret } from '../api/user-writes';

/**
 * Holds a one-time password in component state only: it never enters the Query cache. Closing
 * the dialog clears it, and the API cannot show it again (README D5).
 */
export function useOneTimeSecret() {
  const [secret, setSecret] = useState<OneTimeSecret | null>(null);
  const clear = useCallback(() => setSecret(null), []);
  return { secret, reveal: setSecret, clear };
}
