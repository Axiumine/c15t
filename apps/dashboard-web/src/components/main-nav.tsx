// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Me } from '@consent/shared';
import { Link } from '@tanstack/react-router';

export const navLink =
  'rounded-md px-2.5 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground';

/** Role-aware navigation. Hiding links is UX: the API refuses what the role may not do. */
export function MainNav({ role }: Readonly<{ role: Me['role'] }>) {
  return (
    <nav aria-label="Main" className="flex flex-wrap items-center gap-1 text-sm">
      <Link to="/sites" className={navLink}>
        Sites
      </Link>
      {role === 'admin' ? (
        <>
          <Link to="/admin/overview" className={navLink}>
            Overview
          </Link>
          <Link to="/admin/users" className={navLink}>
            Users
          </Link>
          <Link to="/admin/sites" className={navLink}>
            Manage sites
          </Link>
          <Link to="/admin/audit" className={navLink}>
            Audit log
          </Link>
        </>
      ) : null}
    </nav>
  );
}
