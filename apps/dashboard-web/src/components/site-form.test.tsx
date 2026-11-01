// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { ApiError } from '../api';
import { shop } from '../test/fixtures';
import { SiteForm } from './site-form';
import { parseDomainList, type SiteFormValues, siteFormSchema } from './site-form-schema';

describe('parseDomainList', () => {
  test('splits on new lines, commas and spaces, and drops empties', () => {
    expect(parseDomainList('a.example.com\nb.example.com, c.example.com  d.example.com')).toEqual([
      'a.example.com',
      'b.example.com',
      'c.example.com',
      'd.example.com',
    ]);
    expect(parseDomainList(' ,\n, ')).toEqual([]);
    expect(parseDomainList('')).toEqual([]);
  });
});

describe('siteFormSchema', () => {
  const valid = {
    key: 'shop',
    name: ' Shop ',
    domains: 'Shop.example.com, www.shop.example.com',
    policyPreset: 'eu-opt-in',
  };

  test('accepts what the API accepts and normalises it the same way', () => {
    expect(siteFormSchema.parse(valid)).toEqual({
      key: 'shop',
      name: 'Shop',
      domains: ['shop.example.com', 'www.shop.example.com'],
      policyPreset: 'eu-opt-in',
    });
  });

  test('names the offending domain, and leaves list-level problems unprefixed', () => {
    const wildcard = siteFormSchema.safeParse({
      ...valid,
      domains: 'ok.example.com *.example.com',
    });
    expect(wildcard.error?.issues.map((issue) => issue.message)).toEqual([
      '*.example.com: Wildcards are not allowed',
      '*.example.com: Must be a host name such as shop.example.com',
    ]);
    expect(wildcard.error?.issues.every((issue) => issue.path[0] === 'domains')).toBe(true);

    const empty = siteFormSchema.safeParse({ ...valid, domains: ' , ' });
    expect(empty.error?.issues.map((issue) => issue.message)).toEqual([
      'At least one domain is required',
    ]);

    const duplicate = siteFormSchema.safeParse({
      ...valid,
      domains: 'a.example.com a.example.com',
    });
    expect(duplicate.error?.issues.map((issue) => issue.message)).toEqual([
      'Domains must be unique',
    ]);
  });
});

function setup(props: Partial<Parameters<typeof SiteForm>[0]> = {}) {
  const onSubmit = vi.fn<(values: SiteFormValues) => Promise<unknown>>(() => Promise.resolve());
  const user = userEvent.setup();
  render(<SiteForm submitLabel="Create site" onSubmit={onSubmit} {...props} />);
  return { onSubmit, user };
}

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Site key'), 'shop');
  await user.type(screen.getByLabelText('Name'), 'Shop');
  await user.type(screen.getByLabelText('Domains'), 'shop.example.com');
}

test('a new site starts empty with the default preset and a submit button', () => {
  setup();
  expect(screen.getByLabelText('Site key')).toHaveValue('');
  expect(screen.getByLabelText('Site key')).not.toHaveAttribute('readonly');
  expect(screen.getByText(/It cannot be changed later/)).toBeInTheDocument();
  expect(screen.getByLabelText('Policy preset')).toHaveValue('eu-opt-in');
  expect(screen.getByRole('button', { name: 'Create site' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
});

test('submits the parsed values', async () => {
  const { onSubmit, user } = setup();
  await fill(user);
  await user.selectOptions(screen.getByLabelText('Policy preset'), 'global-preferences');
  await user.click(screen.getByRole('button', { name: 'Create site' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(onSubmit.mock.calls[0]?.[0]).toEqual({
    key: 'shop',
    name: 'Shop',
    domains: ['shop.example.com'],
    policyPreset: 'global-preferences',
  });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('nothing is submitted while a field is invalid, and each field says why', async () => {
  const { onSubmit, user } = setup();
  await user.type(screen.getByLabelText('Site key'), 'No');
  await user.type(screen.getByLabelText('Domains'), 'https://shop.example.com');
  await user.click(screen.getByRole('button', { name: 'Create site' }));

  expect(await screen.findByText(/siteKey must be 3 to 40 characters/)).toBeInTheDocument();
  expect(screen.getByText('This field is required')).toBeInTheDocument();
  expect(
    screen.getByText('https://shop.example.com: Must be a host name such as shop.example.com'),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('Site key')).toHaveAttribute('aria-invalid', 'true');
  expect(onSubmit).not.toHaveBeenCalled();
});

test('editing shows the site, locks the key and offers Cancel', async () => {
  const onCancel = vi.fn();
  const { onSubmit, user } = setup({ site: shop, submitLabel: 'Save', onCancel });
  expect(screen.getByLabelText('Site key')).toHaveValue('shop');
  expect(screen.getByLabelText('Site key')).toHaveAttribute('readonly');
  expect(screen.getByText(/The key is the URL segment and the c15t tenant ID/)).toBeInTheDocument();
  expect(screen.getByLabelText('Name')).toHaveValue('Shop');
  expect(screen.getByLabelText('Domains')).toHaveValue('shop.example.com\nwww.shop.example.com');

  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onSubmit).not.toHaveBeenCalled();

  await user.clear(screen.getByLabelText('Name'));
  await user.type(screen.getByLabelText('Name'), 'Shop EU');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  expect(onSubmit.mock.calls[0]?.[0]).toEqual({
    key: 'shop',
    name: 'Shop EU',
    domains: ['shop.example.com', 'www.shop.example.com'],
    policyPreset: 'eu-opt-in',
  });
});

test('the button reads "Saving…" and is disabled until the request settles', async () => {
  let finish: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const { user } = setup({ onSubmit: () => pending });
  await fill(user);
  await user.click(screen.getByRole('button', { name: 'Create site' }));
  expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled();
  finish();
  expect(await screen.findByRole('button', { name: 'Create site' })).toBeEnabled();
});

test('a taken site key is reported on the key field', async () => {
  const onSubmit = vi.fn(() =>
    Promise.reject(new ApiError({ status: 409, code: 'SITE_KEY_TAKEN', message: 'taken' })),
  );
  const { user } = setup({ onSubmit });
  await fill(user);
  await user.click(screen.getByRole('button', { name: 'Create site' }));
  expect(await screen.findByText('This site key is already in use')).toBeInTheDocument();
  expect(screen.getByLabelText('Site key')).toHaveAttribute('aria-invalid', 'true');
  // It belongs to a field, so there is no form-level banner as well.
  expect(screen.getAllByRole('alert')).toHaveLength(1);
});

test('server validation issues land on their own fields, nested paths included', async () => {
  const onSubmit = vi.fn(() =>
    Promise.reject(
      new ApiError({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        issues: [
          { path: 'domains.1', message: 'Domain is already used by another site' },
          { path: 'name', message: 'Name is reserved' },
          { path: 'policyPreset', message: 'Not available' },
          { path: 'somethingElse', message: 'ignored' },
        ],
      }),
    ),
  );
  const { user } = setup({ onSubmit });
  await fill(user);
  await user.click(screen.getByRole('button', { name: 'Create site' }));
  expect(await screen.findByText('Domain is already used by another site')).toBeInTheDocument();
  expect(screen.getByText('Name is reserved')).toBeInTheDocument();
  expect(screen.getByText('Not available')).toBeInTheDocument();
  expect(screen.queryByText('ignored')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Domains')).toHaveAttribute('aria-invalid', 'true');
});

test('a failure that belongs to no field becomes a form-level message, cleared on the next try', async () => {
  const onSubmit = vi
    .fn<(values: SiteFormValues) => Promise<unknown>>()
    .mockRejectedValueOnce(new ApiError({ status: 503 }))
    .mockResolvedValueOnce(undefined);
  const { user } = setup({ onSubmit });
  await fill(user);
  await user.click(screen.getByRole('button', { name: 'Create site' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The service is temporarily unavailable. Try again in a moment.',
  );

  await user.click(screen.getByRole('button', { name: 'Create site' }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});

test('issues for unknown fields only also fall back to the form-level message', async () => {
  const onSubmit = vi.fn(() =>
    Promise.reject(
      new ApiError({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        issues: [{ path: 'somethingElse', message: 'ignored' }],
      }),
    ),
  );
  const { user } = setup({ onSubmit });
  await fill(user);
  await user.click(screen.getByRole('button', { name: 'Create site' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Invalid input');
});

test('a non-API error shows the generic text, not its own message', async () => {
  const onSubmit = vi.fn(() => Promise.reject(new Error('connection string leaked')));
  const { user } = setup({ onSubmit });
  await fill(user);
  await user.click(screen.getByRole('button', { name: 'Create site' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong. Try again.');
  expect(document.body.textContent).not.toContain('leaked');
});
