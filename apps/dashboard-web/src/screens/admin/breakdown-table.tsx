// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { StatsResponse } from '@consent/shared';
import { Link } from '@tanstack/react-router';
import { SiteStatusBadge } from '../../components/badges';
import { overallOptInRate } from '../../components/charts/stats-charts';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { formatInteger, formatPercent } from '../../lib/format';
import type { Row } from './overview-rows';

const cell = (row: Row, render: (stats: StatsResponse) => string): string => {
  if (row.stats !== undefined) return render(row.stats);
  return row.failed ? 'Unavailable' : '…';
};

function BreakdownRow({ row }: Readonly<{ row: Row }>) {
  const rate = row.stats === undefined ? null : overallOptInRate(row.stats.purposes);
  return (
    <TableRow>
      <TableCell>
        <Link
          to="/sites/$key"
          params={{ key: row.site.key }}
          className="font-medium hover:underline"
        >
          {row.site.name}
        </Link>
      </TableCell>
      <TableCell>
        <SiteStatusBadge status={row.site.status} />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {cell(row, (stats) => formatInteger(stats.totals.consents))}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {cell(row, (stats) => formatInteger(stats.totals.subjects))}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {rate === null ? '–' : formatPercent(rate)}
      </TableCell>
    </TableRow>
  );
}

export function BreakdownTable({ rows }: Readonly<{ rows: readonly Row[] }>) {
  return (
    <Table>
      <caption className="sr-only">Statistics per site</caption>
      <TableHeader>
        <TableRow>
          <TableHead>Site</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Consents</TableHead>
          <TableHead className="text-right">Subjects</TableHead>
          <TableHead className="text-right">Opt-in rate</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <BreakdownRow key={row.site.key} row={row} />
        ))}
      </TableBody>
    </Table>
  );
}
