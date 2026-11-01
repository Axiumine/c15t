// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { SiteDetail } from '@consent/shared';
import { useUpdateSite } from '../../api';
import { SiteForm } from '../../components/site-form';
import type { SiteFormValues } from '../../components/site-form-schema';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';

export function EditSiteCard({ site }: Readonly<{ site: SiteDetail }>) {
  const update = useUpdateSite();

  async function save(values: SiteFormValues) {
    await update.mutateAsync({
      siteKey: site.key,
      changes: { name: values.name, domains: values.domains, policyPreset: values.policyPreset },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit site</CardTitle>
        <CardDescription>
          Changes reach the consent service within moments. To stop serving a site, disable it under
          Manage sites; its records are kept.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <SiteForm key={site.updatedAt} site={site} submitLabel="Save changes" onSubmit={save} />
      </CardContent>
    </Card>
  );
}
