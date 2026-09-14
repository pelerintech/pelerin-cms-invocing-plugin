/**
 * Dev-mode capture & decide helpers.
 *
 * In dev mode the plugin intercepts invoice operations and captures the
 * would-be request into an `invoice_logs` row instead of calling the
 * provider. `captureRequest` writes a `pending` log (pure DB write — no
 * provider call, no invoice mutation, no state advance); `simulateOutcome`
 * later applies the operator's chosen outcome via the authoritative data
 * accessors and flips the log to `decided`.
 */
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import { createDevLog, getDevLog, setDevLogOutcome, type DevLogRow } from './data/logs.ts';
import { getInvoiceById, setInvoiceStatus } from './data/invoices.ts';

export interface CaptureRequestInput {
  invoiceId: string | null;
  operation: string;
  provider: string | null;
  requestJson: unknown;
  fromStatus: string;
}

/** Insert a `pending` dev log row for a captured request. */
export async function captureRequest(
  db: LibSQLDatabase,
  input: CaptureRequestInput
): Promise<DevLogRow> {
  return createDevLog(db, input);
}

export interface SimulateOutcomeOptions {
  outcome: 'success' | 'failure';
  series?: string;
  number?: string;
  pdfLink?: string;
  error?: string;
}

export interface SimulateOutcomeResult {
  ok: boolean;
  status?: string;
  log?: DevLogRow;
  error?: string;
}

/** Apply one branch (success or failure) of an operation's outcome table. */
async function applyTransition(
  db: LibSQLDatabase,
  log: DevLogRow,
  opts: SimulateOutcomeOptions
): Promise<{ ok: boolean; status?: string; error?: string }> {
  const invoiceId = log.invoice_id;
  if (!invoiceId) return { ok: false, error: 'Log has no invoice' };

  const failure = opts.outcome === 'failure';
  const errorText = opts.error ?? 'Provider failed';

  switch (log.operation) {
    case 'emit':
    case 'retry': {
      if (failure) {
        await setInvoiceStatus(db, invoiceId, 'failed', { error: errorText });
        return { ok: true, status: 'failed' };
      }
      await setInvoiceStatus(db, invoiceId, 'issued', {
        series: opts.series ?? null,
        number: opts.number ?? null,
        pdf_link: opts.pdfLink ?? null,
        provider_ref: log.invoice_id,
        error: null,
        issue_date: new Date(),
      });
      return { ok: true, status: 'issued' };
    }
    case 'print': {
      await setInvoiceStatus(db, invoiceId, 'issued', {
        pdf_link: failure ? undefined : (opts.pdfLink ?? undefined),
        error: failure ? errorText : undefined,
      });
      return { ok: true, status: 'issued' };
    }
    case 'storno': {
      if (failure) {
        await setInvoiceStatus(db, invoiceId, 'issued', { error: errorText });
        return { ok: true, status: 'issued' };
      }
      await setInvoiceStatus(db, invoiceId, 'storned', {
        provider_ref: opts.series && opts.number ? `${opts.series}/${opts.number}` : null,
        error: null,
      });
      return { ok: true, status: 'storned' };
    }
    case 'cancel': {
      if (failure) {
        await setInvoiceStatus(db, invoiceId, 'issued', { error: errorText });
        return { ok: true, status: 'issued' };
      }
      await setInvoiceStatus(db, invoiceId, 'cancelled', { error: null });
      return { ok: true, status: 'cancelled' };
    }
    default:
      return { ok: false, error: `Unknown operation "${log.operation}"` };
  }
}

/**
 * Apply an operator-chosen outcome to a captured log, driving the invoice
 * into the selected state via the authoritative data accessors. Returns
 * `{ ok: false, error }` when the transition is invalid: an already-decided
 * log, or a storno/cancel success on an invoice that is not `issued`.
 */
export async function simulateOutcome(
  db: LibSQLDatabase,
  logId: string,
  opts: SimulateOutcomeOptions
): Promise<SimulateOutcomeResult> {
  const log = await getDevLog(db, logId);
  if (!log) return { ok: false, error: 'Log not found' };
  if (log.resolution === 'decided') return { ok: false, error: 'Log already decided' };

  // State guard: storno/cancel success requires the invoice to be `issued`.
  if ((log.operation === 'storno' || log.operation === 'cancel') && opts.outcome === 'success') {
    const invoice = log.invoice_id ? await getInvoiceById(db, log.invoice_id) : null;
    if (!invoice || invoice.status !== 'issued') {
      return { ok: false, error: 'Invoice is not in an "issued" state' };
    }
  }

  const applied = await applyTransition(db, log, opts);
  if (!applied.ok) return applied;

  await setDevLogOutcome(db, logId, {
    success: opts.outcome === 'success',
    error: opts.outcome === 'failure' ? (opts.error ?? 'Provider failed') : undefined,
    resultJson:
      opts.outcome === 'success'
        ? { series: opts.series, number: opts.number, pdfLink: opts.pdfLink }
        : undefined,
  });

  const updated = await getDevLog(db, logId);
  return { ok: true, status: applied.status, log: updated ?? undefined };
}
