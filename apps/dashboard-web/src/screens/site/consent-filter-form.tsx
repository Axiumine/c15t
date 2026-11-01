// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { zodResolver } from '@hookform/resolvers/zod';
import { Search } from 'lucide-react';
import { type FieldErrors, type UseFormRegister, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Field, fieldProps } from '../../components/form-field';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { type ConsentSearch, type FilterValues, filterFormSchema } from './consent-filter-schema';

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

export function FilterForm({
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
