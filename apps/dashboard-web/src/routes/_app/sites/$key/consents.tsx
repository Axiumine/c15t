// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { ConsentsScreen } from '../../../../screens/site/consents';

const searchSchema = z.object({
  subject: z.string().max(200).optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
});

export const Route = createFileRoute('/_app/sites/$key/consents')({
  validateSearch: searchSchema,
  component: ConsentsRoute,
});

function ConsentsRoute() {
  const { key } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ConsentsScreen
      siteKey={key}
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
    />
  );
}
