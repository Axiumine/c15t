// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { createFileRoute } from '@tanstack/react-router';
import { rangeSearchSchema } from '../../../lib/range-search';
import { AdminOverviewScreen } from '../../../screens/admin/overview';

export const Route = createFileRoute('/_app/admin/overview')({
  validateSearch: rangeSearchSchema,
  component: OverviewRoute,
});

function OverviewRoute() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AdminOverviewScreen
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
    />
  );
}
