// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { CONSENT_CATEGORIES, type SiteDetail } from '@consent/shared';
import { CodeBlock } from '../../components/copy-button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';

export function SetupSnippets({ site }: Readonly<{ site: SiteDetail }>) {
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
