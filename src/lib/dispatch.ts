/**
 * Event ingestion & emission — the durable, idempotent critical path.
 *
 * `ingestInvoice(db, payload)` records the self-contained `shop.order.invoice`
 * event as one `invoices` row per order (never duplicated), then emits it to
 * the configured invoicing provider. Because the CMS event bus is fire-and-
 * forget and drops async errors, this layer is the reliability boundary:
 *  - the event is recorded first (nothing lost),
 *  - a failed provider call leaves the row in `failed` (retryable by an admin),
 *  - an already-`issued` (terminal) order is a frozen no-op.
 *
 * A provider may be injected for tests; by default it is resolved from the
 * registry (`fgo`). `init.ts` is a thin subscribe→dispatch wrapper around this.
 */
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { InvoicingProvider, CreateResult } from '../providers/invoicing/interface.ts';
import { getProvider } from '../providers/invoicing/registry.ts';
import { buildInvoiceDraft } from '../providers/invoicing/draft.ts';
import { createInvoice, getInvoiceByOrder, setInvoiceStatus } from './data/invoices.ts';
import type { OrderInvoicePayload } from './order-payload.ts';
import '../providers/invoicing/fgo.ts'; // auto-register the default provider

export interface IngestOptions {
  /** Provider to emit through (defaults to the registry's `fgo`). */
  provider?: InvoicingProvider;
  /** Force a providerName when creating the row. */
  providerName?: string;
  issueDate?: string;
}

export interface IngestResult {
  status: string;
  id: string | null;
  reprocessed: boolean;
  error?: string;
}

const TERMINAL = new Set(['issued', 'storned', 'cancelled']);

/** Emit an invoice from its stored payload via the provider. */
async function emitInvoice(
  db: LibSQLDatabase,
  invoiceId: string,
  payload: OrderInvoicePayload,
  providerName: string,
  provider: InvoicingProvider,
  opts: IngestOptions
): Promise<string> {
  // Refresh the snapshot + mark pending before the (slow/failing) provider call.
  await setInvoiceStatus(db, invoiceId, 'pending', {
    snapshot_json: JSON.stringify(payload),
    error: null,
  });

  const draft = buildInvoiceDraft(payload, { issueDate: opts.issueDate });
  let result: CreateResult;
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
    return 'issued';
  }
  await setInvoiceStatus(db, invoiceId, 'failed', { error: result.error ?? 'Provider failed' });
  return 'failed';
}

/**
 * Idempotent, durable ingestion of a `shop.order.invoice` event.
 * One order → one invoice; terminal rows are a frozen no-op.
 */
export async function ingestInvoice(
  db: LibSQLDatabase,
  payload: OrderInvoicePayload,
  providerOverride?: InvoicingProvider,
  opts: IngestOptions = {}
): Promise<IngestResult> {
  const orderId = payload.orderId;
  const providerName = opts.providerName ?? providerOverride?.name ?? 'fgo';
  const provider = providerOverride ?? getProvider(providerName);
  if (!provider) {
    throw new Error(`Invoicing provider "${providerName}" is not registered`);
  }

  const existing = await getInvoiceByOrder(db, orderId);
  if (existing) {
    if (TERMINAL.has(existing.status)) {
      // Frozen snapshot; terminal rows never re-emit.
      return { status: existing.status, id: existing.id, reprocessed: false };
    }
    // Non-terminal (received/pending/failed): refresh snapshot + re-attempt.
    const status = await emitInvoice(db, existing.id, payload, providerName, provider, opts);
    return { status, id: existing.id, reprocessed: true };
  }

  // New order — create the row first (durable), then emit.
  const created = await createInvoice(db, { orderId, payload, provider: providerName });
  const status = await emitInvoice(db, created.id, payload, providerName, provider, opts);
  return { status, id: created.id, reprocessed: false };
}
