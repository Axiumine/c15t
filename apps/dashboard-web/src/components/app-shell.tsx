// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { Me } from '@consent/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Outlet } from '@tanstack/react-router';
import { LogOut } from 'lucide-react';
import { useSignOut } from '../session';
import { Button } from './ui/button';

const navLink =
  'rounded-md px-2.5 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground';

/** Role-aware navigation. Hiding links is UX: the API refuses what the role may not do. */
export function MainNav({ role }: { role: Me['role'] }) {
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

export function AppShell({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const signOut = useSignOut(queryClient);
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
          <Link to="/sites" className="font-semibold tracking-tight">
            Consent dashboard
          </Link>
          {me.mustChangePassword ? null : <MainNav role={me.role} />}
          <div className="ml-auto flex items-center gap-2 text-sm">
            <Link to="/account" className={navLink} title="Your account">
              {me.email}
            </Link>
            <Button type="button" variant="outline" size="sm" onClick={() => void signOut()}>
              <LogOut aria-hidden="true" />
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 outline-none"
      >
        <Outlet />
      </main>
    </div>
  );
}
