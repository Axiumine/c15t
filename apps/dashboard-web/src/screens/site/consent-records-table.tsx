// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { ConsentRecord } from '@consent/shared';
import { Button } from '../../components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { formatDateTime } from '../../lib/format';
import { PurposeBadges } from './consent-detail';

function RecordRow({
  record,
  onOpen,
}: Readonly<{
  record: ConsentRecord;
  onOpen: (record: ConsentRecord) => void;
}>) {
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap">{formatDateTime(record.givenAt)}</TableCell>
      <TableCell className="max-w-56">
        <span className="block truncate font-mono text-xs" title={record.subjectId}>
          {record.subjectId}
        </span>
        {record.externalId === null ? null : (
          <span className="block truncate text-xs text-muted-foreground">{record.externalId}</span>
        )}
      </TableCell>
      <TableCell>
        <PurposeBadges purposes={record.purposes} />
      </TableCell>
      <TableCell>{record.jurisdiction ?? '–'}</TableCell>
      <TableCell>{record.countryCode ?? '–'}</TableCell>
      <TableCell className="text-right">
        <Button type="button" size="sm" variant="ghost" onClick={() => onOpen(record)}>
          Details
          <span className="sr-only"> for {record.subjectId}</span>
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function RecordsTable({
  items,
  onOpen,
}: Readonly<{
  items: readonly ConsentRecord[];
  onOpen: (record: ConsentRecord) => void;
}>) {
  return (
    <Table>
      <caption className="sr-only">Consent records, newest first</caption>
      <TableHeader>
        <TableRow>
          <TableHead>Given at</TableHead>
          <TableHead>Subject</TableHead>
          <TableHead>Decision</TableHead>
          <TableHead>Jurisdiction</TableHead>
          <TableHead>Country</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((record) => (
          <RecordRow key={record.id} record={record} onOpen={onOpen} />
        ))}
      </TableBody>
    </Table>
  );
}
