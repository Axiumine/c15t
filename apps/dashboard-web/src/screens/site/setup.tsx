// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { POLICY_PRESET_LABELS, POLICY_PRESET_RULES, type SiteDetail } from '@consent/shared';
import { useMe, useSite } from '../../api';
import { ErrorState, LoadingBlock } from '../../components/states';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { EditSiteCard } from './edit-site-card';
import { SetupSnippets } from './setup-snippets';

function SiteFacts({ site }: Readonly<{ site: SiteDetail }>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuration</CardTitle>
        <CardDescription>Read-only here unless you are an administrator.</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted-foreground">Domains</dt>
          <dd>
            <ul className="grid gap-0.5 font-mono text-xs sm:text-sm">
              {site.domains.map((domain) => (
                <li key={domain}>{domain}</li>
              ))}
            </ul>
          </dd>
          <dt className="text-muted-foreground">Policy preset</dt>
          <dd>
            <p>{POLICY_PRESET_LABELS[site.policyPreset]}</p>
            <p className="font-mono text-xs text-muted-foreground">
              {POLICY_PRESET_RULES[site.policyPreset].join(', ')}
            </p>
          </dd>
        </dl>
      </CardContent>
    </Card>
  );
}

export function SetupScreen({ siteKey }: Readonly<{ siteKey: string }>) {
  const site = useSite(siteKey);
  const me = useMe();
  if (site.isPending) return <LoadingBlock label="Loading setup" />;
  if (site.isError) return <ErrorState error={site.error} onRetry={() => void site.refetch()} />;
  return (
    <div className="grid gap-6">
      <SiteFacts site={site.data} />
      {me.data?.role === 'admin' ? <EditSiteCard site={site.data} /> : null}
      <SetupSnippets site={site.data} />
    </div>
  );
}
