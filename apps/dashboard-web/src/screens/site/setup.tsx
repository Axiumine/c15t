// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import {
  CONSENT_CATEGORIES,
  POLICY_PRESET_LABELS,
  POLICY_PRESET_RULES,
  type SiteDetail,
} from '@consent/shared';
import { useMe, useSite, useUpdateSite } from '../../api';
import { CodeBlock } from '../../components/copy-button';
import { SiteForm, type SiteFormValues } from '../../components/site-form';
import { ErrorState, LoadingBlock } from '../../components/states';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';

function SetupSnippets({ site }: { site: SiteDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect the website</CardTitle>
        <CardDescription>
          Add the two nginx lines to this website's server block, then run{' '}
          <code className="font-mono text-xs">sudo nginx -t && sudo systemctl reload nginx</code>.
          The banner then reaches the platform at the same origin, under{' '}
          <code className="font-mono text-xs">{site.setup.backendUrl}</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <CodeBlock title="nginx" code={site.setup.nginx} />
        <CodeBlock title="Banner script tag" code={site.setup.scriptTag} />
        <p className="text-xs text-muted-foreground">
          <code className="font-mono">data-categories</code> lists the consent categories the banner
          offers. Replace the values with the categories your website really uses (
          {CONSENT_CATEGORIES.filter((category) => category !== 'necessary').join(', ')};{' '}
          <code className="font-mono">necessary</code> is always included). Without it, "Accept All"
          on a page with no tagged scripts records only <code className="font-mono">necessary</code>
          , and the opt-in rate per purpose on the Stats page stays empty.
        </p>
        <CodeBlock title="Server-side client" code={site.setup.serverClient} />
        <p className="text-xs text-muted-foreground">
          Framework packages (such as <code className="font-mono">@c15t/react</code>) take{' '}
          <code className="font-mono">backendURL: '{site.setup.backendUrl}'</code> instead of the
          script tag. The server-side client reads its API key from the environment.
        </p>
      </CardContent>
    </Card>
  );
}

function SiteFacts({ site }: { site: SiteDetail }) {
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

function EditSiteCard({ site }: { site: SiteDetail }) {
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

export function SetupScreen({ siteKey }: { siteKey: string }) {
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
