import type { InvoiceDraft } from './interface.ts';
import { billingName, type OrderInvoicePayload } from '../../lib/order-payload.ts';
import type { OrderInvoiceItem } from '../../lib/order-payload.ts';

export interface BuildDraftOptions {
  issueDate?: string;
}

/** ecomm stores money in minor units (bani/cents); a single unit = this fraction of the major unit. */
const MINOR_TO_MAJOR = 1 / 100;

/**
 * Build a provider-neutral canonical invoice draft from the self-contained
 * `shop.order.invoice` payload (the ecomm order `data` shape).
 *
 * This is the pure mapping seam from the ecomm published order `data` to the
 * provider-normalized draft: it consumes the payload directly (no cross-plugin
 * DB access), converts minor-unit money to the invoice currency magnitude, and
 * derives PJ/PF bill-to from the billing address.
 *
 * Pure function — no db, no IO. `issueDate` defaults to today (ISO date part);
 * pass it explicitly for deterministic tests.
 */
export function buildInvoiceDraft(
  payload: OrderInvoicePayload,
  opts: BuildDraftOptions = {}
): InvoiceDraft {
  const issueDate = opts.issueDate ?? new Date().toISOString().slice(0, 10);

  const lines = payload.items.map((item) => mapLine(item));
  const billing = payload.billing_address || {};

  // PJ (company) when a company is present, otherwise PF (the billing name).
  const isPJ = Boolean(billing.company);
  const name = billingName(billing, payload.order);

  return {
    externalOrderId: payload.order.id,
    currency: payload.order.currency,
    issueDate,
    billTo: {
      name,
      fiscalCode: billing.vat_number || '',
      address: billing.address || '',
      city: billing.city || '',
      county: billing.county || undefined,
      country: billing.country || '',
      email: payload.order.customer_email || undefined,
      // ecomm publishes no phone on the billing/order payload.
      phone: undefined,
      vatPayer: isPJ,
    },
    lines,
    // seriesName is left for provider/config, not populated from the payload.
  };
}

/** Map one ecomm order item to a provider-normalized draft line (minor→major). */
function mapLine(item: OrderInvoiceItem): InvoiceDraft['lines'][number] {
  return {
    name: item.product_name,
    code: item.sku || undefined,
    quantity: item.quantity,
    unit: undefined,
    // ecomm prices are stored net in minor units → convert to major.
    unitPriceNet: item.price_net * MINOR_TO_MAJOR,
    vatRate: item.vat_rate,
    vatIncluded: false,
  };
}
