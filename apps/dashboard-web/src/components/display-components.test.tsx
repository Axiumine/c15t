// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { ApiError } from '../api';
import { userSummary } from '../test/fixtures';
import { RoleBadge, SiteStatusBadge, UserStateBadges } from './badges';
import { LoadMore } from './load-more';
import { PageHeader } from './page-header';
import { EmptyState, ErrorState, LoadingBlock } from './states';

test('site status reads Active or Disabled', () => {
  const { rerender } = render(<SiteStatusBadge status="active" />);
  expect(screen.getByText('Active')).toBeInTheDocument();
  rerender(<SiteStatusBadge status="disabled" />);
  expect(screen.getByText('Disabled')).toBeInTheDocument();
  expect(screen.queryByText('Active')).not.toBeInTheDocument();
});

test('the role badge tells admins from users', () => {
  // Spread, so the linter does not mistake the component's `role` prop for an ARIA role.
  const { rerender } = render(<RoleBadge {...{ role: 'admin' as const }} />);
  expect(screen.getByText('Admin')).toBeInTheDocument();
  rerender(<RoleBadge {...{ role: 'user' as const }} />);
  expect(screen.getByText('User')).toBeInTheDocument();
  expect(screen.queryByText('Admin')).not.toBeInTheDocument();
});

test('user state shows Active, Banned and a pending password change', () => {
  const { rerender } = render(<UserStateBadges user={userSummary()} />);
  expect(screen.getByText('Active')).toBeInTheDocument();
  expect(screen.queryByText('Banned')).not.toBeInTheDocument();
  expect(screen.queryByText('Password change pending')).not.toBeInTheDocument();

  rerender(<UserStateBadges user={userSummary({ banned: true, mustChangePassword: true })} />);
  expect(screen.getByText('Banned')).toBeInTheDocument();
  expect(screen.getByText('Password change pending')).toBeInTheDocument();
  expect(screen.queryByText('Active')).not.toBeInTheDocument();
});

test('the page header shows the title, and description and actions only when given', () => {
  const { rerender, container } = render(<PageHeader title="Sites" />);
  expect(screen.getByRole('heading', { level: 1, name: 'Sites' })).toBeInTheDocument();
  const header = container.firstElementChild;
  // Only the title block: no actions wrapper, and no description inside the title block.
  expect(header?.children).toHaveLength(1);
  expect(header?.firstElementChild?.children).toHaveLength(1);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();

  rerender(
    <PageHeader
      title="Sites"
      description={<span>Everything we serve</span>}
      actions={<button type="button">New site</button>}
    />,
  );
  expect(screen.getByText('Everything we serve')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'New site' })).toBeInTheDocument();
  expect(container.firstElementChild?.children).toHaveLength(2);
  expect(container.firstElementChild?.firstElementChild?.children).toHaveLength(2);
});

test('load more reports progress and offers the next page while there is one', async () => {
  const onMore = vi.fn();
  render(
    <LoadMore
      loaded={1250}
      noun="consents"
      endLabel="that is all"
      hasMore
      fetching={false}
      onMore={onMore}
    />,
  );
  expect(screen.getByText('1,250 consents loaded')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Load more' }));
  expect(onMore).toHaveBeenCalledTimes(1);
});

test('load more is disabled while fetching and takes a custom label', () => {
  const { rerender } = render(
    <LoadMore
      loaded={3}
      noun="rows"
      endLabel="end"
      hasMore
      fetching={false}
      onMore={vi.fn()}
      moreLabel="Older entries"
    />,
  );
  expect(screen.getByRole('button', { name: 'Older entries' })).toBeEnabled();
  rerender(
    <LoadMore
      loaded={3}
      noun="rows"
      endLabel="end"
      hasMore
      fetching
      onMore={vi.fn()}
      moreLabel="Older entries"
    />,
  );
  expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled();
});

test('load more says where the list ends and drops the button', () => {
  render(
    <LoadMore
      loaded={1}
      noun="rows"
      endLabel="that is all"
      hasMore={false}
      fetching={false}
      onMore={vi.fn()}
    />,
  );
  expect(screen.getByText('1 rows loaded, that is all')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});

test('the loading block announces itself politely, with a default and a custom label', () => {
  const { rerender } = render(<LoadingBlock />);
  const status = screen.getByRole('status');
  expect(status).toHaveAttribute('aria-busy', 'true');
  expect(status).toHaveTextContent('Loading…');
  rerender(<LoadingBlock label="Loading sites" />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading sites…');
});

test('the error state names a temporary outage differently from other failures', () => {
  const { rerender } = render(<ErrorState error={new ApiError({ status: 503 })} />);
  expect(screen.getByText('Temporarily unavailable')).toBeInTheDocument();
  expect(screen.getByText(/temporarily unavailable. Try again/)).toBeInTheDocument();
  rerender(<ErrorState error={new Error('boom')} />);
  expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  expect(screen.queryByText('boom')).not.toBeInTheDocument();
});

test('the error state offers "Try again" only when there is something to retry', async () => {
  const onRetry = vi.fn();
  const { rerender } = render(<ErrorState error={new Error('x')} />);
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  rerender(<ErrorState error={new Error('x')} onRetry={onRetry} />);
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

test('the empty state shows a description and an action when they are given', () => {
  const { rerender } = render(<EmptyState title="Nothing yet" />);
  expect(screen.getByText('Nothing yet')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(document.querySelectorAll('p')).toHaveLength(1);

  rerender(
    <EmptyState
      title="Nothing yet"
      description="Add the first one"
      action={<button type="button">Add</button>}
    />,
  );
  expect(screen.getByText('Add the first one')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
});
