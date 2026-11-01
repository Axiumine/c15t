// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Site } from '@consent/shared';
import { Link } from '@tanstack/react-router';
import { SiteStatusBadge } from '../../components/badges';
import { Button } from '../../components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import type { SiteAction } from './site-action';

function SiteRow({
  site,
  onAction,
}: Readonly<{ site: Site; onAction: (action: SiteAction) => void }>) {
  return (
    <TableRow>
      <TableCell>
        <Link to="/sites/$key" params={{ key: site.key }} className="font-medium hover:underline">
          {site.name}
        </Link>
        <span className="block font-mono text-xs text-muted-foreground">{site.key}</span>
      </TableCell>
      <TableCell className="max-w-72 break-words">{site.domains.join(', ')}</TableCell>
      <TableCell>
        <SiteStatusBadge status={site.status} />
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onAction({ kind: 'edit', site })}
          >
            Edit<span className="sr-only"> {site.name}</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => onAction({ kind: 'status', site })}
          >
            {site.status === 'active' ? 'Disable' : 'Enable'}
            <span className="sr-only"> {site.name}</span>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export function SitesTable({
  sites,
  onAction,
}: Readonly<{ sites: readonly Site[]; onAction: (action: SiteAction) => void }>) {
  return (
    <Table>
      <caption className="sr-only">All sites</caption>
      <TableHeader>
        <TableRow>
          <TableHead>Site</TableHead>
          <TableHead>Domains</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sites.map((site) => (
          <SiteRow key={site.key} site={site} onAction={onAction} />
        ))}
      </TableBody>
    </Table>
  );
}
