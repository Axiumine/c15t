// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { formatInteger, formatPercent } from '../../lib/format';
import { EmptyState } from '../states';
import { ChartFrame } from './chart-frame';
import { ChartTable } from './chart-table';
import { type BarDatum, RankedBars } from './ranked-bars';
import { foldJurisdictions, type Jurisdiction } from './stats-figures';

export function JurisdictionChart({
  jurisdictions,
  total,
  busy,
}: Readonly<{
  jurisdictions: readonly Jurisdiction[];
  total: number;
  busy: boolean;
}>) {
  const folded = foldJurisdictions(jurisdictions);
  const share = (consents: number) => (total === 0 ? 0 : consents / total);
  const data: BarDatum[] = folded.map((item) => ({
    name: item.jurisdiction,
    value: item.consents,
    display: formatInteger(item.consents),
    details: [{ label: 'of all consents', value: formatPercent(share(item.consents)) }],
  }));
  return (
    <ChartFrame
      title="Consents by jurisdiction"
      summary="Where the visitors were when they decided."
      busy={busy}
      chart={
        data.length === 0 ? (
          <EmptyState title="No consents in this period" />
        ) : (
          <RankedBars data={data} valueLabel="consents" />
        )
      }
      table={
        <ChartTable
          caption="Consents by jurisdiction"
          label={{ header: 'Jurisdiction', cell: (item) => item.jurisdiction }}
          columns={[
            { header: 'Consents', cell: (item) => formatInteger(item.consents) },
            { header: 'Share', cell: (item) => formatPercent(share(item.consents)) },
          ]}
          rows={folded}
          rowKey={(item) => item.jurisdiction}
        />
      }
    />
  );
}
