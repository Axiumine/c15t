// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Site } from '@consent/shared';
import { FormError } from './form-field';
import { SiteFormFields } from './site-form-fields';
import type { SiteFormValues } from './site-form-schema';
import { Button } from './ui/button';
import { useSiteForm } from './use-site-form';

export function SiteForm({
  site,
  submitLabel,
  onSubmit,
  onCancel,
}: Readonly<{
  /** Set when editing: the site key is then shown but cannot change. */
  site?: Site | undefined;
  submitLabel: string;
  onSubmit: (values: SiteFormValues) => Promise<unknown>;
  onCancel?: (() => void) | undefined;
}>) {
  const { register, errors, isSubmitting, formError, submit } = useSiteForm(site, onSubmit);
  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <FormError message={formError} />
      <SiteFormFields editing={site !== undefined} errors={errors} register={register} />
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
