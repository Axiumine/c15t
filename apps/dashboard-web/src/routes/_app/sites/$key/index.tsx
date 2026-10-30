// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { createFileRoute } from '@tanstack/react-router';
import { rangeSearchSchema } from '../../../../lib/range-search';
import { SiteOverviewScreen } from '../../../../screens/site/overview';

export const Route = createFileRoute('/_app/sites/$key/')({
  validateSearch: rangeSearchSchema,
  component: SiteOverviewRoute,
});

function SiteOverviewRoute() {
  const { key } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <SiteOverviewScreen
      siteKey={key}
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
    />
  );
}
