/**
 * The self-contained `shop.order.invoice` event payload.
 *
 * This is the contract between the ecommerce plugin (producer) and this
 * plugin (consumer). It deliberately mirrors ecomm's published order `data`
 * (built by `buildOrderEventData` in ecomm_plugin): `{ order, billing_address,
 * shipping_address, items }`. It is self-contained — it carries the order
 * totals/currency, billing address (incl. company + VAT number), and line
 * items with net price + VAT rate — so the invoicing plugin never queries
 * shop tables directly.
 *
 * The bus delivers these as `{ event, timestamp, data }`; the subscriber
 * passes the envelope's `data` object here, so this type IS the `data` shape.
 *
 * Money fields (`subtotal_net`, `vat_total`, `total`, `price_net`,
 * `price_gross`) are in MINOR units (bani/cents), matching ecomm's storage;
 * the draft mapping converts them to the invoice currency's major magnitude.
 * `vat_rate` is a fraction (0.19 = 19%), matching ecomm's storage.
 *
 * If a future feature needs data not present here, this contract grows — not
 * the cross-plugin DB coupling.
 */

export interface OrderInvoiceItem {
  product_name: string;
  sku?: string | null;
  quantity: number;
  /** Net unit price in MINOR units (bani/cents). */
  price_net: number;
  /** VAT rate as a fraction (0.19 = 19%). */
  vat_rate: number;
  /** Gross unit price in MINOR units. */
  price_gross: number;
  currency?: string | null;
}

export interface OrderInvoiceAddress {
  first_name?: string | null;
  last_name?: string | null;
  address?: string | null;
  city?: string | null;
  county?: string | null;
  postal_code?: string | null;
  country?: string | null;
  company?: string | null;
  vat_number?: string | null;
}

export interface OrderInvoicePayload {
  order: {
    id: string;
    order_number: string;
    status?: string | null;
    currency: string;
    customer_email?: string | null;
    customer_name?: string | null;
    /** Minor units. */
    subtotal_net?: number | null;
    /** Minor units. */
    vat_total?: number | null;
    /** Minor units. */
    total?: number | null;
    /** Account id of the consumer who owns this order (ownership for public download). */
    user_id?: string | null;
  };
  billing_address: OrderInvoiceAddress;
  shipping_address?: OrderInvoiceAddress;
  items: OrderInvoiceItem[];
}

/** Parse a stored snapshot back into a payload object. */
export function parseSnapshot(raw: string): OrderInvoicePayload {
  return JSON.parse(raw) as OrderInvoicePayload;
}

/** The ecomm order `data` is the same shape as this payload. */
export type OrderEventData = OrderInvoicePayload;

/**
 * The billing display name: company preferred, else first+last name, else the
 * order's customer_name. Pure helper shared by the draft + invoice accessor.
 */
export function billingName(
  addr: OrderInvoiceAddress,
  order?: OrderInvoicePayload['order']
): string {
  if (addr?.company) return addr.company;
  const full = [addr?.first_name, addr?.last_name].filter(Boolean).join(' ');
  if (full) return full;
  return order?.customer_name || '';
}
