// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { type ConsentRecord, consentListQuerySchema } from '@consent/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Download, Search } from 'lucide-react';
import { useState } from 'react';
import { type FieldErrors, type UseFormRegister, useForm } from 'react-hook-form';
import { z } from 'zod';
import { consentsCsvHref, useConsents } from '../../api';
import { Field, fieldProps } from '../../components/form-field';
import { LoadMore } from '../../components/load-more';
import { EmptyState, ErrorState, LoadingBlock } from '../../components/states';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { formatDateTime } from '../../lib/format';
import { ConsentDetailDialog, PurposeBadges } from './consent-detail';

export interface ConsentSearch {
  readonly subject?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

function toQuery(value: {
  subject: string;
  from: string;
  to: string;
}): z.input<typeof consentListQuerySchema> {
  return {
    ...(value.subject.trim() === '' ? {} : { subject: value.subject.trim() }),
    ...(value.from === '' ? {} : { from: value.from }),
    ...(value.to === '' ? {} : { to: value.to }),
  };
}

/** The shared list-query schema decides what a valid filter is (range order, subject length). */
export const filterFormSchema = z
  .object({ subject: z.string(), from: z.string(), to: z.string() })
  .transform(toQuery)
  .pipe(consentListQuerySchema);

type FilterValues = z.input<typeof filterFormSchema>;

function FilterFields({
  errors,
  register,
}: Readonly<{
  errors: FieldErrors<FilterValues>;
  register: UseFormRegister<FilterValues>;
}>) {
  return (
    <>
      <Field id="filter-subject" label="Subject ID" error={errors.subject?.message}>
        <Input
          {...fieldProps('filter-subject', errors.subject?.message)}
          {...register('subject')}
          className="w-64"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <Field id="filter-from" label="From" error={errors.from?.message}>
        <Input
          {...fieldProps('filter-from', errors.from?.message)}
          {...register('from')}
          type="date"
          className="w-40"
        />
      </Field>
      <Field id="filter-to" label="To (inclusive)" error={errors.to?.message}>
        <Input
          {...fieldProps('filter-to', errors.to?.message)}
          {...register('to')}
          type="date"
          className="w-40"
        />
      </Field>
    </>
  );
}

function FilterForm({
  value,
  onApply,
}: Readonly<{
  value: ConsentSearch;
  onApply: (next: ConsentSearch) => void;
}>) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(filterFormSchema),
    defaultValues: { subject: value.subject ?? '', from: value.from ?? '', to: value.to ?? '' },
  });

  function apply(values: z.output<typeof filterFormSchema>) {
    onApply({ subject: values.subject, from: values.from, to: values.to });
  }

  function clear() {
    const blank: FilterValues = { subject: '', from: '', to: '' };
    reset(blank);
    onApply({});
  }

  return (
    <form className="flex flex-wrap items-start gap-3" onSubmit={handleSubmit(apply)} noValidate>
      <FilterFields errors={errors} register={register} />
      <div className="flex gap-2 pt-[1.625rem]">
        <Button type="submit">
          <Search aria-hidden="true" />
          Search
        </Button>
        <Button type="button" variant="outline" onClick={clear}>
          Clear
        </Button>
      </div>
    </form>
  );
}

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

function RecordsTable({
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

function RecordsBody({
  records,
  items,
  onOpen,
}: Readonly<{
  records: ReturnType<typeof useConsents>;
  items: readonly ConsentRecord[];
  onOpen: (record: ConsentRecord) => void;
}>) {
  if (records.isPending) return <LoadingBlock label="Loading records" />;
  if (records.isError && items.length === 0) {
    return <ErrorState error={records.error} onRetry={() => void records.refetch()} />;
  }
  if (items.length === 0) {
    return (
      <EmptyState
        title="No records found"
        description="Nothing matches these filters. Widen the date range or clear the subject ID."
      />
    );
  }
  return (
    <div className="grid gap-3">
      <RecordsTable items={items} onOpen={onOpen} />
      {records.isError ? (
        <ErrorState error={records.error} onRetry={() => void records.fetchNextPage()} />
      ) : null}
      <LoadMore
        loaded={items.length}
        noun="records"
        endLabel="end of list"
        hasMore={records.hasNextPage}
        fetching={records.isFetchingNextPage}
        onMore={() => void records.fetchNextPage()}
      />
    </div>
  );
}

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
