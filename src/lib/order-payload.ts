/**
 * The self-contained `shop.order.invoice` event payload.
 *
 * This is the contract between the ecommerce plugin (producer) and this
 * plugin (consumer). It is deliberately self-contained — it carries the order
 * totals/currency, billing address (incl. company + VAT number), and line
 * items with net price + VAT rate — so the invoicing plugin never queries
 * shop tables directly.
 *
 * The exact payload shape mirrors `buildOrderEventPayload` from ecomm_plugin.
 * If a future feature needs data not present here, this contract grows — not
 * the cross-plugin DB coupling.
 */

export interface OrderLineItem {
  /** Product line reference (sku or code). */
  code?: string;
  name: string;
  quantity: number;
  unit?: string;
  /** Net price of a single unit, in the order currency. */
  unitPriceNet: number;
  /** VAT rate as a fraction (0.19 = 19%). */
  vatRate: number;
  /** Whether the unit price already includes VAT. */
  vatIncluded: boolean;
}

export interface OrderInvoicePayload {
  orderId: string;
  orderNumber: string;
  currency: string;
  /** Account id of the consumer who owns this order (ownership for public download). */
  userId?: string | null;
  customer?: {
    name: string;
    email?: string | null;
    phone?: string | null;
  };
  billing: {
    name: string;
    company?: string | null;
    vatNumber?: string | null;
    address: string;
    city: string;
    county?: string | null;
    country: string;
    email?: string | null;
    phone?: string | null;
  };
  items: OrderLineItem[];
  totals?: {
    currency?: string;
    subtotalNet?: number;
    vatTotal?: number;
    total?: number;
  };
}

/** Parse a stored snapshot back into a payload object. */
export function parseSnapshot(raw: string): OrderInvoicePayload {
  return JSON.parse(raw) as OrderInvoicePayload;
}
