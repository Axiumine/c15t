// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

export interface TableColumn<Row> {
  readonly header: string;
  readonly cell: (row: Row) => string;
}

/**
 * The accessible twin of a chart: one left-aligned label column, then right-aligned tabular
 * figure columns, with a screen-reader caption.
 */
export function ChartTable<Row>({
  caption,
  label,
  columns,
  rows,
  rowKey,
}: Readonly<{
  caption: string;
  label: TableColumn<Row>;
  columns: readonly TableColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
}>) {
  return (
    <Table>
      <caption className="sr-only">{caption}</caption>
      <TableHeader>
        <TableRow>
          <TableHead>{label.header}</TableHead>
          {columns.map((column) => (
            <TableHead key={column.header} className="text-right">
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={rowKey(row)}>
            <TableCell>{label.cell(row)}</TableCell>
            {columns.map((column) => (
              <TableCell key={column.header} className="text-right tabular-nums">
                {column.cell(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
