// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { ConsentRecord } from '@consent/shared';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { consentsCsvHref, useConsents } from '../../api';
import { Button } from '../../components/ui/button';
import { ConsentDetailDialog } from './consent-detail';
import { FilterForm } from './consent-filter-form';
import type { ConsentSearch } from './consent-filter-schema';
import { RecordsBody } from './consent-records';

/** The CSV export covers the selected dates; the subject filter applies to the list only. */
function exportRangeOf(search: ConsentSearch): { from?: string; to?: string } {
  return {
    ...(search.from === undefined ? {} : { from: search.from }),
    ...(search.to === undefined ? {} : { to: search.to }),
  };
}

export function ConsentsScreen({
  siteKey,
  search,
  onSearchChange,
}: Readonly<{
  siteKey: string;
  search: ConsentSearch;
  onSearchChange: (next: ConsentSearch) => void;
}>) {
  const records = useConsents(siteKey, search);
  const [open, setOpen] = useState<ConsentRecord | null>(null);
  const items = records.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <FilterForm key={JSON.stringify(search)} value={search} onApply={onSearchChange} />
        <div className="grid gap-1 pt-[1.625rem]">
          <Button asChild variant="outline">
            <a href={consentsCsvHref(siteKey, exportRangeOf(search))} download>
              <Download aria-hidden="true" />
              Export CSV
            </a>
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        The export covers the selected dates. The subject ID filter applies to this list only.
      </p>
      <div aria-busy={records.isFetching && !records.isPending}>
        <RecordsBody records={records} items={items} onOpen={setOpen} />
      </div>
      <ConsentDetailDialog record={open} onClose={() => setOpen(null)} />
    </div>
  );
}
