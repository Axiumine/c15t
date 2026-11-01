// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { ConsentRecord } from '@consent/shared';
import { Check, X } from 'lucide-react';
import { Badge } from '../../components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { formatDateTime } from '../../lib/format';

/** Icon plus word, so a decision never rests on colour alone. */
export function PurposeBadges({ purposes }: Readonly<{ purposes: Record<string, boolean> }>) {
  const entries = Object.entries(purposes).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return <span className="text-muted-foreground">–</span>;
  return (
    <ul className="flex flex-wrap gap-1">
      {entries.map(([purpose, granted]) => (
        <li key={purpose}>
          <Badge variant={granted ? 'success' : 'neutral'}>
            {granted ? (
              <Check className="size-3" aria-hidden="true" />
            ) : (
              <X className="size-3" aria-hidden="true" />
            )}
            {purpose}
            <span className="sr-only">{granted ? ' granted' : ' denied'}</span>
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function rows(record: ConsentRecord): [string, string][] {
  const dash = (value: string | null) => value ?? '–';
  return [
    ['Record ID', record.id],
    ['Given at', formatDateTime(record.givenAt)],
    ['Valid until', record.validUntil === null ? '–' : formatDateTime(record.validUntil)],
    ['Subject ID', record.subjectId],
    ['External ID', dash(record.externalId)],
    ['Domain', dash(record.domain)],
    ['Action', dash(record.consentAction)],
    ['Jurisdiction', dash(record.jurisdiction)],
    ['Jurisdiction model', dash(record.jurisdictionModel)],
    ['Country', dash(record.countryCode)],
    ['Region', dash(record.regionCode)],
    ['Banner source', dash(record.uiSource)],
    ['IP address', dash(record.ipAddress)],
    ['User agent', dash(record.userAgent)],
  ];
}

export function ConsentDetailDialog({
  record,
  onClose,
}: Readonly<{
  record: ConsentRecord | null;
  onClose: () => void;
}>) {
  return (
    <Dialog open={record !== null} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl">
        {record === null ? null : (
          <>
            <DialogHeader>
              <DialogTitle>Consent record</DialogTitle>
              <DialogDescription>
                Read-only. Consent records are kept as legal proof.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <h3 className="text-sm font-medium">Decision</h3>
              <PurposeBadges purposes={record.purposes} />
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
              {rows(record).map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-mono text-xs break-all sm:text-sm">{value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
