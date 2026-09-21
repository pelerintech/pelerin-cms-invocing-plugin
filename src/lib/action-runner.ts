/**
 * Admin-initiated provider actions on an invoice.
 *
 * Retry re-emits a `failed` invoice from its stored snapshot; print/storno/
 * cancel operate on an `issued` one and reflect the provider result locally.
 * Every action is state-guarded — an action not allowed for the invoice's
 * current status is rejected WITHOUT a provider call.
 *
 * A provider may be injected for tests; by default it resolves from the
 * registry via the invoice's stored `provider`.
 */
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { InvoicingProvider } from '../providers/invoicing/interface.ts';
import { getProvider } from '../providers/invoicing/registry.ts';
import { buildInvoiceDraft } from '../providers/invoicing/draft.ts';
import { getInvoiceById, setInvoiceStatus } from './data/invoices.ts';
import { captureRequest } from './dev-capture.ts';
import { isDevMode } from './dev-mode.ts';
import { publishInvoiceReady, type PublishEvent } from './invoice-ready.ts';
import { parseSnapshot } from './order-payload.ts';

export interface ActionResult {
  ok: boolean;
  status?: string;
  pdfLink?: string;
  error?: string;
  /** The captured log id when dev mode parked the request. */
  logId?: string;
}

/** Capture a would-be request in dev mode and report the parked result. */
async function captureInDevMode(
  db: LibSQLDatabase,
  invoice: { id: string; provider: string | null; status: string },
  operation: string,
  requestJson: unknown
): Promise<ActionResult | null> {
  if (!isDevMode()) return null;
  const log = await captureRequest(db, {
    invoiceId: invoice.id,
    operation,
    provider: invoice.provider,
    requestJson,
    fromStatus: invoice.status,
  });
  return { ok: true, status: 'captured', logId: log.id };
}

async function resolveProvider(
  invoice: { provider: string | null },
  override?: InvoicingProvider
): Promise<InvoicingProvider | null> {
  if (override) return override;
  return getProvider(invoice.provider ?? 'fgo');
}

/** Optional behavior options for the action runner actions. */
export interface ActionOptions {
  /** The event bus `publish` callback, used to emit `invoicing.invoice.ready`. */
  publish?: PublishEvent;
}

/** Retry a failed invoice: rebuild draft from stored snapshot and emit again. */
export async function retryInvoice(
  db: LibSQLDatabase,
  invoiceId: string,
  providerOverride?: InvoicingProvider,
  opts: ActionOptions = {}
): Promise<ActionResult> {
  const invoice = await getInvoiceById(db, invoiceId);
  if (!invoice) return { ok: false, error: 'Invoice not found' };
  if (invoice.status !== 'failed') {
    return { ok: false, error: `Invoice status "${invoice.status}" does not allow a retry` };
  }
  const payload = parseSnapshot(invoice.snapshot_json);
  const draft = buildInvoiceDraft(payload);
  const parked = await captureInDevMode(db, invoice, 'retry', draft);
  if (parked) return parked;
  const provider = await resolveProvider(invoice, providerOverride);
  if (!provider) return { ok: false, error: 'Invoicing provider not registered' };

  let result;
  try {
    result = await provider.create(db, draft);
  } catch (err) {
    result = { success: false, error: String((err as Error).message || err) };
  }

  if (result.success) {
    const row = await setInvoiceStatus(db, invoiceId, 'issued', {
      series: result.series ?? null,
      number: result.number ?? null,
      pdf_link: result.pdfLink ?? null,
      provider_ref: draft.externalOrderId,
      error: null,
      issue_date: new Date(),
      req_payload: JSON.stringify(result.request),
      res_payload: JSON.stringify(result.response),
    });
    publishInvoiceReady(opts.publish, row);
    return { ok: true, status: 'issued' };
  }
  await setInvoiceStatus(db, invoiceId, 'failed', {
    error: result.error ?? 'Provider failed',
    req_payload: JSON.stringify(result.request),
    res_payload: JSON.stringify(result.response),
  });
  return { ok: false, error: result.error ?? 'Provider failed' };
}

/** Print an issued invoice; stores the pdf link if returned and absent. */
export async function printInvoice(
  db: LibSQLDatabase,
  invoiceId: string,
  providerOverride?: InvoicingProvider
): Promise<ActionResult> {
  const invoice = await getInvoiceById(db, invoiceId);
  if (!invoice) return { ok: false, error: 'Invoice not found' };
  if (invoice.status !== 'issued' || !invoice.series || !invoice.number) {
    return { ok: false, error: `Invoice status "${invoice.status}" does not allow printing` };
  }
  const parked = await captureInDevMode(db, invoice, 'print', {
    series: invoice.series,
    number: invoice.number,
  });
  if (parked) return parked;
  const provider = await resolveProvider(invoice, providerOverride);
  if (!provider) return { ok: false, error: 'Invoicing provider not registered' };

  let result;
  try {
    result = await provider.print(db, invoice.series, invoice.number);
  } catch (err) {
    result = { success: false, error: String((err as Error).message || err) };
  }
  if (!result.success) {
    await setInvoiceStatus(db, invoiceId, invoice.status, {
      error: result.error ?? 'Print failed',
      req_payload: JSON.stringify(result.request),
      res_payload: JSON.stringify(result.response),
    });
    return { ok: false, error: result.error ?? 'Print failed' };
  }
  await setInvoiceStatus(db, invoiceId, invoice.status, {
    ...(result.pdfLink && !invoice.pdf_link ? { pdf_link: result.pdfLink } : {}),
    req_payload: JSON.stringify(result.request),
    res_payload: JSON.stringify(result.response),
  });
  return { ok: true, pdfLink: result.pdfLink };
}

/** Storno an issued invoice → storned (terminal). */
export async function stornoInvoice(
  db: LibSQLDatabase,
  invoiceId: string,
  providerOverride?: InvoicingProvider
): Promise<ActionResult> {
  const invoice = await getInvoiceById(db, invoiceId);
  if (!invoice) return { ok: false, error: 'Invoice not found' };
  if (invoice.status !== 'issued' || !invoice.series || !invoice.number) {
    return { ok: false, error: `Invoice status "${invoice.status}" does not allow storno` };
  }
  const parked = await captureInDevMode(db, invoice, 'storno', {
    series: invoice.series,
    number: invoice.number,
  });
  if (parked) return parked;
  const provider = await resolveProvider(invoice, providerOverride);
  if (!provider) return { ok: false, error: 'Invoicing provider not registered' };

  let result;
  try {
    result = await provider.storno(db, invoice.series, invoice.number);
  } catch (err) {
    result = { success: false, error: String((err as Error).message || err) };
  }
  if (!result.success) {
    await setInvoiceStatus(db, invoiceId, invoice.status, {
      error: result.error ?? 'Storno failed',
      req_payload: JSON.stringify(result.request),
      res_payload: JSON.stringify(result.response),
    });
    return { ok: false, error: result.error ?? 'Storno failed' };
  }
  const ref =
    result.seriesStorno && result.numberStorno
      ? `${result.seriesStorno}/${result.numberStorno}`
      : null;
  await setInvoiceStatus(db, invoiceId, 'storned', {
    provider_ref: ref,
    error: null,
    req_payload: JSON.stringify(result.request),
    res_payload: JSON.stringify(result.response),
  });
  return { ok: true, status: 'storned' };
}

/** Cancel (anulare) an issued invoice → cancelled (terminal). */
export async function cancelInvoice(
  db: LibSQLDatabase,
  invoiceId: string,
  providerOverride?: InvoicingProvider
): Promise<ActionResult> {
  const invoice = await getInvoiceById(db, invoiceId);
  if (!invoice) return { ok: false, error: 'Invoice not found' };
  if (invoice.status !== 'issued' || !invoice.series || !invoice.number) {
    return { ok: false, error: `Invoice status "${invoice.status}" does not allow cancel` };
  }
  const parked = await captureInDevMode(db, invoice, 'cancel', {
    series: invoice.series,
    number: invoice.number,
  });
  if (parked) return parked;
  const provider = await resolveProvider(invoice, providerOverride);
  if (!provider) return { ok: false, error: 'Invoicing provider not registered' };

  let result;
  try {
    result = await provider.cancel(db, invoice.series, invoice.number);
  } catch (err) {
    result = { success: false, error: String((err as Error).message || err) };
  }
  if (!result.success) {
    await setInvoiceStatus(db, invoiceId, invoice.status, {
      error: result.error ?? 'Cancel failed',
      req_payload: JSON.stringify(result.request),
      res_payload: JSON.stringify(result.response),
    });
    return { ok: false, error: result.error ?? 'Cancel failed' };
  }
  await setInvoiceStatus(db, invoiceId, 'cancelled', {
    error: null,
    req_payload: JSON.stringify(result.request),
    res_payload: JSON.stringify(result.response),
  });
  return { ok: true, status: 'cancelled' };
}
