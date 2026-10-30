// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { ReactNode } from 'react';
import { Card } from '../ui/card';

/** A headline number: sentence-case label, proportional figures for the value. */
export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <Card className="grid content-start gap-1 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-3xl font-semibold tracking-tight">{value}</p>
      {hint === undefined ? null : <p className="text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}
