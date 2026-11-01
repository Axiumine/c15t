// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { formatDay, formatInteger } from '../../lib/format';
import { ChartFrame } from './chart-frame';
import { ChartTable } from './chart-table';
import { VolumeArea } from './volume-area';
import { type Day, volumeSummary } from './volume-summary';

export function VolumeChart({ volume, busy }: Readonly<{ volume: readonly Day[]; busy: boolean }>) {
  return (
    <ChartFrame
      title="Consent volume"
      summary={volumeSummary(volume)}
      busy={busy}
      chart={<VolumeArea volume={volume} />}
      table={
        <ChartTable
          caption="Consents per day"
          label={{ header: 'Date (UTC)', cell: (day) => formatDay(day.date, true) }}
          columns={[{ header: 'Consents', cell: (day) => formatInteger(day.consents) }]}
          rows={volume}
          rowKey={(day) => day.date}
        />
      }
    />
  );
}
