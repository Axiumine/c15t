// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { expect, type Page } from '@playwright/test';
import type { Credentials } from './bootstrap.js';

/** The dashboard screens, driven the way a person does it: roles and labels only. */

export async function signInUi(page: Page, credentials: Credentials): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(credentials.email);
  await page.getByLabel('Password').fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function changePasswordUi(page: Page, current: string, next: string): Promise<void> {
  await page.getByLabel('Current password').fill(current);
  await page.getByLabel('New password', { exact: true }).fill(next);
  await page.getByLabel('Repeat new password').fill(next);
  await page.getByRole('button', { name: 'Change password' }).click();
}

/** Signs in with a one-time password and replaces it. Ends on the sites list. */
export async function firstSignInUi(page: Page, initial: Credentials, next: string): Promise<void> {
  await signInUi(page, initial);
  await expect(page).toHaveURL(/\/account$/);
  await changePasswordUi(page, initial.password, next);
  await expect(page).toHaveURL(/\/sites$/);
}

export function mainNav(page: Page) {
  return page.getByRole('navigation', { name: 'Main' });
}

export async function signOutUi(page: Page): Promise<void> {
  await page.getByRole('banner').getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
}

/** Opens the admin users table and returns the row of one user. */
export async function userRow(page: Page, email: string) {
  await mainNav(page).getByRole('link', { name: 'Users' }).click();
  await expect(page.getByRole('heading', { name: 'Users', level: 1 })).toBeVisible();
  return page.getByRole('row', { name: new RegExp(email) });
}
