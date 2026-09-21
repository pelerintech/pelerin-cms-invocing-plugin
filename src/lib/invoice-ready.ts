/**
 * Invoice-ready notification event emitter.
 *
 * The plugin publishes `invoicing.invoice.ready` when a real emit confirms an
 * invoice is issued AND a download link is present, so `notifications_plugin`
 * can email the customer the invoice PDF. The event is published at most once
 * per invoice because `issued` is terminal.
 *
 * The event's `data` is a self-contained `{ invoice: {...} }` node; the CMS bus
 * wraps it into `{ event, timestamp, data }`, so notification templates
 * reference `data.invoice.*`.
 */
import type { InvoiceRow } from './data/invoices.ts';

/** The event name published to the CMS event bus. */
export const INVOICE_READY_EVENT = 'invoicing.invoice.ready';

/** The bus `publish` callback: (event name, event data). */
export type PublishEvent = (event: string, data: Record<string, unknown>) => void;

/**
 * Publish `invoicing.invoice.ready` for an issued invoice that has a download
 * link. No-op when `publish` is absent, the row is not `issued`, or it has no
 * `pdf_link`. Called by the emit paths (dispatch.emitInvoice and
 * action-runner.retryInvoice) after the invoice is marked issued.
 */
export function publishInvoiceReady(publish: PublishEvent | undefined, row: InvoiceRow): void {
  if (!publish) return;
  if (row.status !== 'issued' || !row.pdf_link) return;
  publish(INVOICE_READY_EVENT, {
    invoice: {
      id: row.id,
      order_id: row.order_id,
      order_number: row.order_number,
      customer_name: row.customer_name,
      customer_email: row.customer_email,
      series: row.series,
      number: row.number,
      pdf_link: row.pdf_link,
    },
  });
}
