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
import { parseSnapshot } from './order-payload.ts';

export interface ActionResult {
  ok: boolean;
  status?: string;
  pdfLink?: string;
  error?: string;
}

async function resolveProvider(
  invoice: { provider: string | null },
  override?: InvoicingProvider
): Promise<InvoicingProvider | null> {
  if (override) return override;
  return getProvider(invoice.provider ?? 'fgo');
}

/** Retry a failed invoice: rebuild draft from stored snapshot and emit again. */
export async function retryInvoice(
  db: LibSQLDatabase,
  invoiceId: string,
  providerOverride?: InvoicingProvider
): Promise<ActionResult> {
  const invoice = await getInvoiceById(db, invoiceId);
  if (!invoice) return { ok: false, error: 'Invoice not found' };
  if (invoice.status !== 'failed') {
    return { ok: false, error: `Invoice status "${invoice.status}" does not allow a retry` };
  }
  const provider = await resolveProvider(invoice, providerOverride);
  if (!provider) return { ok: false, error: 'Invoicing provider not registered' };

  const payload = parseSnapshot(invoice.snapshot_json);
  const draft = buildInvoiceDraft(payload);

  let result;
  try {
    result = await provider.create(db, draft);
  } catch (err) {
    result = { success: false, error: String((err as Error).message || err) };
  }

  if (result.success) {
    await setInvoiceStatus(db, invoiceId, 'issued', {
      series: result.series ?? null,
      number: result.number ?? null,
      pdf_link: result.pdfLink ?? null,
      provider_ref: draft.externalOrderId,
      error: null,
      issue_date: new Date(),
    });
    return { ok: true, status: 'issued' };
  }
  await setInvoiceStatus(db, invoiceId, 'failed', { error: result.error ?? 'Provider failed' });
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
  const provider = await resolveProvider(invoice, providerOverride);
  if (!provider) return { ok: false, error: 'Invoicing provider not registered' };

  let result;
  try {
    result = await provider.print(db, invoice.series, invoice.number);
  } catch (err) {
    result = { success: false, error: String((err as Error).message || err) };
  }
  if (!result.success) {
    return { ok: false, error: result.error ?? 'Print failed' };
  }
  if (result.pdfLink && !invoice.pdf_link) {
    await setInvoiceStatus(db, invoiceId, invoice.status, { pdf_link: result.pdfLink });
  }
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
  const provider = await resolveProvider(invoice, providerOverride);
  if (!provider) return { ok: false, error: 'Invoicing provider not registered' };

  let result;
  try {
    result = await provider.storno(db, invoice.series, invoice.number);
  } catch (err) {
    result = { success: false, error: String((err as Error).message || err) };
  }
  if (!result.success) {
    return { ok: false, error: result.error ?? 'Storno failed' };
  }
  const ref =
    result.seriesStorno && result.numberStorno
      ? `${result.seriesStorno}/${result.numberStorno}`
      : null;
  await setInvoiceStatus(db, invoiceId, 'storned', { provider_ref: ref, error: null });
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
  const provider = await resolveProvider(invoice, providerOverride);
  if (!provider) return { ok: false, error: 'Invoicing provider not registered' };

  let result;
  try {
    result = await provider.cancel(db, invoice.series, invoice.number);
  } catch (err) {
    result = { success: false, error: String((err as Error).message || err) };
  }
  if (!result.success) {
    return { ok: false, error: result.error ?? 'Cancel failed' };
  }
  await setInvoiceStatus(db, invoiceId, 'cancelled', { error: null });
  return { ok: true, status: 'cancelled' };
}
