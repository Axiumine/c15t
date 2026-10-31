// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { render, screen } from '@testing-library/react';
import type { TooltipContentProps } from 'recharts';
import { expect, test } from 'vitest';
import { ChartTooltip, hoveredDatum } from './chart-tooltip';

/** Recharts hands the tooltip many more fields; the helper reads only these two. */
function props(partial: { active?: boolean; payload?: readonly { payload: unknown }[] }) {
  return partial as unknown as TooltipContentProps;
}

test('the tooltip leads each row with its value and keys only the first row with the series colour', () => {
  const { container } = render(
    <ChartTooltip
      title="GDPR"
      rows={[
        { label: 'consents', value: '1,000' },
        { label: 'of all consents', value: '78%' },
      ]}
    />,
  );
  expect(screen.getByText('GDPR')).toBeInTheDocument();
  const rows = container.querySelectorAll('p.flex');
  expect(rows).toHaveLength(2);
  expect(rows[0]?.textContent).toBe('1,000consents');
  expect(rows[1]?.textContent).toBe('78%of all consents');
  expect(rows[0]?.querySelector('span.bg-\\[var\\(--viz-1\\)\\]')).not.toBeNull();
  expect(rows[1]?.querySelector('span.bg-\\[var\\(--viz-1\\)\\]')).toBeNull();
});

test('labels from the API are rendered as text, never as markup', () => {
  const { container } = render(
    <ChartTooltip
      title={'<img src=x onerror=alert(1)>'}
      rows={[{ label: '<b>bold</b>', value: '1' }]}
    />,
  );
  expect(container.querySelector('img')).toBeNull();
  expect(container.querySelector('b')).toBeNull();
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  expect(screen.getByText('<b>bold</b>')).toBeInTheDocument();
});

test('a tooltip without rows still shows its title', () => {
  const { container } = render(<ChartTooltip title="Empty" rows={[]} />);
  expect(screen.getByText('Empty')).toBeInTheDocument();
  expect(container.querySelectorAll('p.flex')).toHaveLength(0);
});

test('hoveredDatum returns the data point of the first hovered mark', () => {
  const datum = { name: 'GDPR', value: 1 };
  expect(hoveredDatum<typeof datum>(props({ active: true, payload: [{ payload: datum }] }))).toBe(
    datum,
  );
  const second = { name: 'CCPA', value: 2 };
  expect(
    hoveredDatum<typeof datum>(
      props({ active: true, payload: [{ payload: datum }, { payload: second }] }),
    ),
  ).toBe(datum);
});

test('hoveredDatum is empty between marks', () => {
  const datum = { name: 'GDPR' };
  expect(hoveredDatum(props({ active: false, payload: [{ payload: datum }] }))).toBeUndefined();
  expect(hoveredDatum(props({ payload: [{ payload: datum }] }))).toBeUndefined();
  expect(hoveredDatum(props({ active: true, payload: [] }))).toBeUndefined();
  expect(hoveredDatum(props({ active: true }))).toBeUndefined();
});
