// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import type { StatsResponse } from '@consent/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { stats } from '../../test/fixtures';
import { type BarDatum, RankedBars } from './ranked-bars';
import { foldJurisdictions, overallOptInRate, StatsCharts } from './stats-charts';
import { VolumeChart } from './volume-chart';

type Jurisdiction = StatsResponse['jurisdictions'][number];

const bars: BarDatum[] = [
  {
    name: 'GDPR',
    value: 1000,
    display: '1,000',
    details: [{ label: 'of all consents', value: '78.1%' }],
  },
  { name: 'CCPA', value: 280, display: '280', details: [] },
];

/** Recharts reads pointer positions from the wrapper; the test setup gives it 600 x 300. */
function hover(container: HTMLElement, x: number, y: number) {
  const wrapper = container.querySelector('.recharts-wrapper');
  if (wrapper === null) throw new Error('chart did not render');
  fireEvent.mouseMove(wrapper, { clientX: x, clientY: y });
}

async function renderedChart(container: HTMLElement) {
  await waitFor(() => expect(container.querySelector('.recharts-wrapper')).not.toBeNull());
}

describe('overallOptInRate', () => {
  test('is granted over all decisions across every purpose', () => {
    expect(
      overallOptInRate([
        { purpose: 'measurement', granted: 900, denied: 380, optInRate: 0.703 },
        { purpose: 'marketing', granted: 300, denied: 980, optInRate: 0.234 },
      ]),
    ).toBeCloseTo(1200 / 2560, 10);
  });

  test('is null when nothing was decided', () => {
    expect(overallOptInRate([])).toBeNull();
    expect(overallOptInRate([{ purpose: 'x', granted: 0, denied: 0, optInRate: 0 }])).toBeNull();
  });
});

describe('foldJurisdictions', () => {
  const make = (count: number): Jurisdiction[] =>
    Array.from({ length: count }, (_, index) => ({
      jurisdiction: `J${index + 1}`,
      consents: (index + 1) * 10,
    }));

  test('sorts by consents, largest first, without touching the input', () => {
    const input = make(3);
    expect(foldJurisdictions(input).map((item) => item.jurisdiction)).toEqual(['J3', 'J2', 'J1']);
    expect(input.map((item) => item.jurisdiction)).toEqual(['J1', 'J2', 'J3']);
  });

  test('keeps eight entries as they are', () => {
    const folded = foldJurisdictions(make(8));
    expect(folded).toHaveLength(8);
    expect(folded.some((item) => item.jurisdiction === 'Other')).toBe(false);
  });

  test('folds everything beyond the top seven into "Other", so there are never more than eight bars', () => {
    const folded = foldJurisdictions(make(12));
    expect(folded).toHaveLength(8);
    expect(folded.slice(0, 7).map((item) => item.jurisdiction)).toEqual([
      'J12',
      'J11',
      'J10',
      'J9',
      'J8',
      'J7',
      'J6',
    ]);
    // J5 + J4 + J3 + J2 + J1 = 50 + 40 + 30 + 20 + 10
    expect(folded[7]).toEqual({ jurisdiction: 'Other', consents: 150 });
    const total = (items: readonly Jurisdiction[]) =>
      items.reduce((sum, item) => sum + item.consents, 0);
    expect(total(folded)).toBe(total(make(12)));
  });
});

function preferReducedMotion() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

describe('RankedBars', () => {
  test('draws one bar per entry, without a track by default', async () => {
    const { container } = render(<RankedBars data={bars} valueLabel="consents" />);
    await renderedChart(container);
    await waitFor(() =>
      expect(container.querySelectorAll('.recharts-bar-rectangle')).toHaveLength(2),
    );
    expect(container.querySelector('.recharts-bar-background-rectangle')).toBeNull();
  });

  test('a track marks the whole behind each bar', async () => {
    const { container } = render(
      <RankedBars
        data={bars.map((bar) => ({ ...bar, value: 0.5 }))}
        valueLabel="rate"
        max={1}
        track
      />,
    );
    await renderedChart(container);
    await waitFor(() =>
      expect(container.querySelectorAll('.recharts-bar-background-rectangle')).toHaveLength(2),
    );
  });

  test('hovering a bar reads out its value first, then the details', async () => {
    const { container } = render(<RankedBars data={bars} valueLabel="consents" />);
    await renderedChart(container);
    hover(container, 100, 20);
    const tooltip = await waitFor(() => {
      const found = container.querySelector('.recharts-tooltip-wrapper .min-w-36');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(within(tooltip).getByText('GDPR')).toBeInTheDocument();
    expect(tooltip.textContent).toBe('GDPR1,000consents78.1%of all consents');
  });

  test('prints the value at the tip of each bar at once when the visitor prefers reduced motion', async () => {
    preferReducedMotion();
    const { container } = render(<RankedBars data={bars} valueLabel="consents" />);
    await renderedChart(container);
    const printed = Array.from(container.querySelectorAll('svg text')).map(
      (node) => node.textContent,
    );
    expect(printed).toContain('1,000');
    expect(printed).toContain('280');
  });
});

describe('VolumeChart', () => {
  const volume = [
    { date: '2026-03-03', consents: 400 },
    { date: '2026-03-04', consents: 0 },
    { date: '2026-03-05', consents: 880 },
    { date: '2026-03-06', consents: 100 },
  ];

  test('summarises the total and the busiest day', () => {
    render(<VolumeChart volume={volume} busy={false} />);
    expect(
      screen.getByText('1,380 consents. Busiest day: 5 Mar 2026 with 880.'),
    ).toBeInTheDocument();
  });

  test('the first of two equally busy days wins', () => {
    render(
      <VolumeChart
        volume={[
          { date: '2026-03-03', consents: 5 },
          { date: '2026-03-04', consents: 5 },
        ]}
        busy={false}
      />,
    );
    expect(screen.getByText(/Busiest day: 3 Mar 2026 with 5/)).toBeInTheDocument();
  });

  test('says so when there is nothing to chart, for no days and for only empty days', () => {
    const { rerender } = render(<VolumeChart volume={[]} busy={false} />);
    expect(screen.getByText('No consents in this period.')).toBeInTheDocument();
    rerender(<VolumeChart volume={volume.map((day) => ({ ...day, consents: 0 }))} busy={false} />);
    expect(screen.getByText('No consents in this period.')).toBeInTheDocument();
  });

  test('keeps the old render dimmed and marked busy during a refetch', () => {
    const { container } = render(<VolumeChart volume={volume} busy />);
    expect(container.querySelector('[aria-busy="true"]')).toHaveClass('opacity-60');
  });

  test('hovering a day reads out its date and count', async () => {
    const { container } = render(<VolumeChart volume={volume} busy={false} />);
    await renderedChart(container);
    hover(container, 300, 100);
    const tooltip = await waitFor(() => {
      const found = container.querySelector('.recharts-tooltip-wrapper .min-w-36');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(tooltip.textContent).toMatch(/^\d{1,2} Mar 2026\d[\d,]*consents$/);
  });

  test('the table twin lists every day', async () => {
    render(<VolumeChart volume={volume} busy={false} />);
    await userEvent.click(screen.getByRole('button', { name: 'table' }));
    const table = screen.getByRole('table', { name: 'Consents per day' });
    expect(within(table).getAllByRole('row')).toHaveLength(5);
    expect(within(table).getByText('4 Mar 2026')).toBeInTheDocument();
  });
});

describe('StatsCharts', () => {
  test('shows the totals and the overall opt-in rate', () => {
    render(<StatsCharts stats={stats} busy={false} />);
    expect(screen.getByText('1,280')).toBeInTheDocument();
    expect(screen.getByText('640')).toBeInTheDocument();
    expect(screen.getByText('46.9%')).toBeInTheDocument();
  });

  test('shows a dash instead of a rate when no decision was made', () => {
    render(<StatsCharts stats={{ ...stats, purposes: [] }} busy={false} />);
    expect(screen.getByText('–')).toBeInTheDocument();
    expect(screen.getByText('No decisions in this period')).toBeInTheDocument();
  });

  test('says so when no jurisdiction has consents', () => {
    render(<StatsCharts stats={{ ...stats, jurisdictions: [] }} busy={false} />);
    expect(screen.getByText('No consents in this period')).toBeInTheDocument();
  });

  test('the purpose table ranks categories by opt-in rate', async () => {
    render(<StatsCharts stats={stats} busy={false} />);
    const view = screen.getByRole('group', { name: 'Opt-in rate by category view' });
    await userEvent.click(within(view).getByRole('button', { name: 'table' }));
    const table = screen.getByRole('table', { name: 'Opt-in rate by category' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('measurement900380');
    expect(rows[1]).toHaveTextContent('70.3%');
    expect(rows[2]).toHaveTextContent('marketing');
  });

  test('the jurisdiction table shows each share of all consents, folded past eight', async () => {
    const many = Array.from({ length: 10 }, (_, index) => ({
      jurisdiction: `J${index + 1}`,
      consents: 100,
    }));
    render(
      <StatsCharts
        stats={{ ...stats, totals: { consents: 1000, subjects: 10 }, jurisdictions: many }}
        busy={false}
      />,
    );
    const view = screen.getByRole('group', { name: 'Consents by jurisdiction view' });
    await userEvent.click(within(view).getByRole('button', { name: 'table' }));
    const table = screen.getByRole('table', { name: 'Consents by jurisdiction' });
    expect(within(table).getAllByRole('row')).toHaveLength(9);
    const other = within(table).getByText('Other').closest('tr');
    expect(other).toHaveTextContent('300');
    expect(other).toHaveTextContent('30%');
  });

  test('a total of zero never divides by zero', async () => {
    render(
      <StatsCharts
        stats={{
          ...stats,
          totals: { consents: 0, subjects: 0 },
          jurisdictions: [{ jurisdiction: 'GDPR', consents: 5 }],
        }}
        busy={false}
      />,
    );
    const view = screen.getByRole('group', { name: 'Consents by jurisdiction view' });
    await userEvent.click(within(view).getByRole('button', { name: 'table' }));
    const row = within(screen.getByRole('table', { name: 'Consents by jurisdiction' }))
      .getByText('GDPR')
      .closest('tr');
    expect(row).toHaveTextContent('0%');
    expect(row).not.toHaveTextContent('NaN');
    expect(row).not.toHaveTextContent('Infinity');
  });

  test('marks every chart busy while a refetch runs', () => {
    const { container } = render(<StatsCharts stats={stats} busy />);
    expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(3);
  });
});
