import type { InvoiceDraft } from './interface.ts';
import type { OrderInvoicePayload } from '../../lib/order-payload.ts';

export interface BuildDraftOptions {
  issueDate?: string;
}

/**
 * Build a provider-neutral canonical invoice draft from the self-contained
 * `shop.order.invoice` payload. Each provider maps this draft to its own JSON.
 *
 * Pure function — no db, no IO. `issueDate` defaults to today (ISO date part);
 * pass it explicitly for deterministic tests.
 */
export function buildInvoiceDraft(
  payload: OrderInvoicePayload,
  opts: BuildDraftOptions = {}
): InvoiceDraft {
  const issueDate = opts.issueDate ?? new Date().toISOString().slice(0, 10);

  const lines = payload.items.map((item) => ({
    name: item.name,
    code: item.code,
    quantity: item.quantity,
    unit: item.unit,
    unitPriceNet: item.unitPriceNet,
    vatRate: item.vatRate,
    vatIncluded: item.vatIncluded,
  }));

  // PJ (company) when a company is present, otherwise PF (the customer/billing name).
  const isPJ = Boolean(payload.billing.company);
  const name = payload.billing.company || payload.billing.name || payload.customer?.name || '';

  return {
    externalOrderId: payload.orderId,
    currency: payload.currency,
    issueDate,
    billTo: {
      name,
      fiscalCode: payload.billing.vatNumber || '',
      address: payload.billing.address,
      city: payload.billing.city,
      county: payload.billing.county || undefined,
      country: payload.billing.country,
      email: payload.billing.email || payload.customer?.email || undefined,
      phone: payload.billing.phone || payload.customer?.phone || undefined,
      vatPayer: isPJ,
    },
    lines,
    // seriesName is left for provider/config, not populated from the payload.
  };
}
