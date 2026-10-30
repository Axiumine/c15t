// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { createFileRoute } from '@tanstack/react-router';
import { SetupScreen } from '../../../../screens/site/setup';

export const Route = createFileRoute('/_app/sites/$key/setup')({ component: SetupRoute });

function SetupRoute() {
  const { key } = Route.useParams();
  return <SetupScreen siteKey={key} />;
}
