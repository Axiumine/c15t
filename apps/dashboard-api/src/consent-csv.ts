// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Axiumine

import { CONSENT_CSV_COLUMNS, type ConsentRecord } from '@consent/shared';
import { csvRow } from './csv.js';

export const CSV_HEADER = csvRow(CONSENT_CSV_COLUMNS);

export function consentCsvRow(record: ConsentRecord): string {
  return csvRow(
    CONSENT_CSV_COLUMNS.map((column) =>
      // eslint-disable-next-line security/detect-object-injection -- column comes from the closed CONSENT_CSV_COLUMNS tuple
      column === 'purposes' ? JSON.stringify(record.purposes) : record[column],
    ),
  );
}

const csvEncoder = new TextEncoder();

/** Sends the text as bytes. An empty text (the end of the batches, header already sent) sends nothing. */
function enqueueText(controller: ReadableStreamDefaultController<Uint8Array>, text: string): void {
  if (text !== '') controller.enqueue(csvEncoder.encode(text));
}

/** The text for one step: the header before the first rows, then the rows of the batch. */
function csvChunk(step: IteratorResult<ConsentRecord[]>, headerSent: boolean): string {
  const header = headerSent ? '' : CSV_HEADER;
  const rows = step.done === true ? '' : step.value.map(consentCsvRow).join('');
  return header + rows;
}

/**
 * CSV body that pulls one batch at a time, so a large site never sits in memory. `first` is the
 * batch the route already fetched (to turn a database failure into a clean 503 before any byte
 * is sent). An error after that point aborts the stream.
 */
export function consentCsvStream(
  batches: AsyncGenerator<ConsentRecord[], void, undefined>,
  first: IteratorResult<ConsentRecord[], void>,
): ReadableStream<Uint8Array> {
  let pending: IteratorResult<ConsentRecord[], void> | undefined = first;
  let headerSent = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const step = pending ?? (await batches.next());
        pending = undefined;
        enqueueText(controller, csvChunk(step, headerSent));
        headerSent = true;
        if (step.done === true) controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await batches.return(undefined);
    },
  });
}
