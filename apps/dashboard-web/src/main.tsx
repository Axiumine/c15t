// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

// Must stay first: zod reads its config when the shared schemas are built, and the CSP forbids
// the `new Function` probe it runs otherwise.
import './lib/zod-setup';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProviders, createApp } from './app';

const container = document.getElementById('root');
if (container === null) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <AppProviders app={createApp()} />
  </StrictMode>,
);
