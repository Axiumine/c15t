// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { RangeSearch } from '../lib/range';
import { RangeFilter } from './range-filter';

beforeEach(() => {
  // Presets end "today (UTC)"; pin the clock so the dates below are fixed.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-31T10:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Keeps the URL state the way the route does: the filter reports, the parent stores. */
function Harness({
  initial = {},
  onChange,
}: Readonly<{
  initial?: RangeSearch;
  onChange: (next: RangeSearch) => void;
}>) {
  const [value, setValue] = useState<RangeSearch>(initial);
  return (
    <RangeFilter
      value={value}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

const period = () => screen.getByLabelText('Period');

test('defaults to the last 30 days and shows the resolved UTC window', () => {
  render(<Harness onChange={vi.fn()} />);
  expect(period()).toHaveValue('30d');
  expect(screen.getByText('2026-03-02 to 2026-03-31 (UTC)')).toBeInTheDocument();
  expect(screen.queryByLabelText('From')).not.toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Date range' })).toBeInTheDocument();
});

test('lists every preset and the custom range', () => {
  render(<Harness onChange={vi.fn()} />);
  const labels = Array.from(period().querySelectorAll('option')).map(
    (option) => option.textContent,
  );
  expect(labels).toEqual(['Last 7 days', 'Last 30 days', 'Last 90 days', 'Custom range']);
});

test('picking a preset reports just the preset and updates the window', () => {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  fireEvent.change(period(), { target: { value: '7d' } });
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ range: '7d' });
  expect(screen.getByText('2026-03-25 to 2026-03-31 (UTC)')).toBeInTheDocument();
});

test('a value that is not a preset is ignored', () => {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  // jsdom drops a value no option carries, so the handler sees an empty string.
  fireEvent.change(period(), { target: { value: 'bogus' } });
  expect(onChange).not.toHaveBeenCalled();
});

test('choosing a custom range starts from the current window and shows the date fields', () => {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  fireEvent.change(period(), { target: { value: 'custom' } });
  expect(onChange).toHaveBeenCalledExactlyOnceWith({
    range: 'custom',
    from: '2026-03-02',
    to: '2026-03-31',
  });
  expect(screen.getByLabelText('From')).toHaveValue('2026-03-02');
  expect(screen.getByLabelText('To (inclusive)')).toHaveValue('2026-03-31');
  expect(screen.queryByText(/\(UTC\)/)).not.toBeInTheDocument();
});

test('a valid edit of either date is reported', () => {
  const onChange = vi.fn();
  render(
    <Harness
      initial={{ range: 'custom', from: '2026-01-05', to: '2026-01-06' }}
      onChange={onChange}
    />,
  );
  expect(screen.getByLabelText('From')).toHaveValue('2026-01-05');

  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-01-02' } });
  expect(onChange).toHaveBeenLastCalledWith({
    range: 'custom',
    from: '2026-01-02',
    to: '2026-01-06',
  });

  fireEvent.change(screen.getByLabelText('To (inclusive)'), { target: { value: '2026-01-20' } });
  expect(onChange).toHaveBeenLastCalledWith({
    range: 'custom',
    from: '2026-01-02',
    to: '2026-01-20',
  });
  expect(onChange).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('an invalid edit is explained and not reported, and a fix is reported again', () => {
  const onChange = vi.fn();
  render(
    <Harness
      initial={{ range: 'custom', from: '2026-01-05', to: '2026-01-06' }}
      onChange={onChange}
    />,
  );

  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-02-01' } });
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'The start date must not be after the end date',
  );
  expect(screen.getByLabelText('From')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('From')).toHaveValue('2026-02-01');

  fireEvent.change(screen.getByLabelText('From'), { target: { value: '' } });
  expect(screen.getByRole('alert')).toHaveTextContent('Choose both dates');
  expect(onChange).not.toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-01-01' } });
  expect(onChange).toHaveBeenCalledExactlyOnceWith({
    range: 'custom',
    from: '2026-01-01',
    to: '2026-01-06',
  });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('a range longer than the API allows is refused in the form', () => {
  const onChange = vi.fn();
  render(
    <Harness
      initial={{ range: 'custom', from: '2026-01-05', to: '2026-01-06' }}
      onChange={onChange}
    />,
  );
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2024-01-01' } });
  expect(screen.getByRole('alert')).toHaveTextContent('at most 366 days');
  expect(onChange).not.toHaveBeenCalled();
});

test('going back to a preset hides the date fields again', () => {
  render(
    <Harness
      initial={{ range: 'custom', from: '2026-01-05', to: '2026-01-06' }}
      onChange={vi.fn()}
    />,
  );
  fireEvent.change(period(), { target: { value: '90d' } });
  expect(screen.queryByLabelText('From')).not.toBeInTheDocument();
  expect(screen.getByText('2026-01-01 to 2026-03-31 (UTC)')).toBeInTheDocument();
});
