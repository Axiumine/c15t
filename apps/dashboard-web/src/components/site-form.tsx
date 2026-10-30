// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import {
  DEFAULT_POLICY_PRESET,
  domainsSchema,
  MAX_DOMAINS_PER_SITE,
  POLICY_PRESET_LABELS,
  POLICY_PRESETS,
  policyPresetSchema,
  type Site,
  siteKeySchema,
  siteNameSchema,
} from '@consent/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { type Path, useForm } from 'react-hook-form';
import { z } from 'zod';
import { ApiError, errorMessage, fieldIssues } from '../api';
import { Field, FormError, fieldProps } from './form-field';
import { Button } from './ui/button';
import { Input, Select, Textarea } from './ui/input';

/** One domain per line; commas and spaces also separate, because people paste lists. */
export function parseDomainList(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/**
 * The textarea holds one string, so list-level and per-domain problems are all reported on the
 * `domains` field, naming the offending domain.
 */
const domainsFieldSchema = z.string().transform((text, ctx) => {
  const list = parseDomainList(text);
  const result = domainsSchema.safeParse(list);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    const index = issue.path[0];
    const culprit = typeof index === 'number' ? list[index] : undefined;
    ctx.addIssue({
      code: 'custom',
      message: culprit === undefined ? issue.message : `${culprit}: ${issue.message}`,
    });
  }
  return z.NEVER;
});

/** Built from the shared field schemas, so the form accepts exactly what the API accepts. */
export const siteFormSchema = z.object({
  key: siteKeySchema,
  name: siteNameSchema,
  domains: domainsFieldSchema,
  policyPreset: policyPresetSchema,
});

export type SiteFormInput = z.input<typeof siteFormSchema>;
export type SiteFormValues = z.output<typeof siteFormSchema>;

type FieldName = Path<SiteFormInput>;
const FIELDS: readonly FieldName[] = ['key', 'name', 'domains', 'policyPreset'];

function fieldOf(path: string): FieldName | undefined {
  const root = path.split('.')[0];
  return FIELDS.find((name) => name === root);
}

/** Server-side rejections that belong to one field of this form. */
function serverFieldErrors(error: unknown): [FieldName, string][] {
  if (error instanceof ApiError && error.code === 'SITE_KEY_TAKEN') {
    return [['key', 'This site key is already in use']];
  }
  return fieldIssues(error).flatMap((issue): [FieldName, string][] => {
    const name = fieldOf(issue.path);
    return name === undefined ? [] : [[name, issue.message]];
  });
}

export function SiteForm({
  site,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  /** Set when editing: the site key is then shown but cannot change. */
  site?: Site | undefined;
  submitLabel: string;
  onSubmit: (values: SiteFormValues) => Promise<unknown>;
  onCancel?: (() => void) | undefined;
}) {
  const editing = site !== undefined;
  const [formError, setFormError] = useState<string | undefined>(undefined);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(siteFormSchema),
    defaultValues: {
      key: site?.key ?? '',
      name: site?.name ?? '',
      domains: site?.domains.join('\n') ?? '',
      policyPreset: site?.policyPreset ?? DEFAULT_POLICY_PRESET,
    },
  });

  async function submit(values: SiteFormValues) {
    setFormError(undefined);
    try {
      await onSubmit(values);
    } catch (error) {
      const handled = serverFieldErrors(error);
      if (handled.length === 0) setFormError(errorMessage(error));
      for (const [name, message] of handled) setError(name, { message });
    }
  }

  return (
    <form className="grid gap-4" onSubmit={handleSubmit(submit)} noValidate>
      <FormError message={formError} />
      <Field
        id="site-key"
        label="Site key"
        error={errors.key?.message}
        hint={
          editing
            ? 'The key is the URL segment and the c15t tenant ID. It cannot be changed.'
            : 'Lowercase letters, digits and hyphens, 3 to 40 characters. It cannot be changed later.'
        }
      >
        <Input
          {...fieldProps('site-key', errors.key?.message, 'hint')}
          {...register('key')}
          readOnly={editing}
          className={editing ? 'bg-muted font-mono' : 'font-mono'}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <Field id="site-name" label="Name" error={errors.name?.message}>
        <Input {...fieldProps('site-name', errors.name?.message)} {...register('name')} />
      </Field>
      <Field
        id="site-domains"
        label="Domains"
        error={errors.domains?.message}
        hint={`One per line, such as shop.example.com. No scheme, path or wildcard. Up to ${MAX_DOMAINS_PER_SITE}.`}
      >
        <Textarea
          {...fieldProps('site-domains', errors.domains?.message, 'hint')}
          {...register('domains')}
          rows={4}
          className="font-mono"
          spellCheck={false}
        />
      </Field>
      <Field id="site-preset" label="Policy preset" error={errors.policyPreset?.message}>
        <Select
          {...fieldProps('site-preset', errors.policyPreset?.message)}
          {...register('policyPreset')}
        >
          {POLICY_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {POLICY_PRESET_LABELS[preset]}
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel === undefined ? null : (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
