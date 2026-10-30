// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { createFileRoute } from '@tanstack/react-router';
import { SiteLayoutScreen } from '../../../../screens/site/site-layout';

export const Route = createFileRoute('/_app/sites/$key')({ component: SiteLayoutRoute });

function SiteLayoutRoute() {
  const { key } = Route.useParams();
  return <SiteLayoutScreen siteKey={key} />;
}
