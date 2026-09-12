/**
 * Shared test fixture: a realistic ecomm-shaped `shop.order.invoice` envelope
 * `data` payload (as built by `buildOrderEventData`). Money is in MINOR units,
 * `vat_rate` is a fraction, and there's a PJ billing address by default.
 *
 * Tests import this to keep the contract in one place instead of each file
 * hand-building an old-shape payload.
 */
import type { OrderInvoicePayload } from '../../src/lib/order-payload.ts';

export interface OrderDataOverrides {
  orderId?: string;
  orderNumber?: string;
  currency?: string;
  customerName?: string | null;
  customerEmail?: string | null;
  userId?: string | null;
  status?: string | null;
  /** Set to null/'' for a PF (no company) billing address. */
  company?: string | null;
  vatNumber?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  address?: string | null;
  city?: string | null;
  county?: string | null;
  country?: string | null;
  items?: OrderInvoicePayload['items'];
}

/** Build a default ecomm order `data` payload with optional overrides. */
export function orderData(overrides: OrderDataOverrides = {}): OrderInvoicePayload {
  const orderId = overrides.orderId ?? 'order-1';
  return {
    order: {
      id: orderId,
      order_number: overrides.orderNumber ?? `ORD-${orderId}`,
      status: overrides.status ?? 'paid',
      currency: overrides.currency ?? 'RON',
      customer_email: overrides.customerEmail ?? 'ana@x.ro',
      customer_name: overrides.customerName ?? 'Ana Popescu',
      subtotal_net: 10000,
      vat_total: 1900,
      total: 11900,
      user_id: overrides.userId ?? null,
    },
    billing_address: {
      first_name: overrides.firstName ?? 'Ana',
      last_name: overrides.lastName ?? 'Popescu',
      address: overrides.address ?? 'Str. X 1',
      city: overrides.city ?? 'Bucuresti',
      county: overrides.county ?? 'B',
      country: overrides.country ?? 'RO',
      company: overrides.company === undefined ? 'SC Exemplu SRL' : overrides.company,
      vat_number: overrides.vatNumber ?? 'RO12345678',
    },
    shipping_address: {},
    items: overrides.items ?? [
      {
        product_name: 'Widget',
        sku: 'W-1',
        quantity: 2,
        price_net: 5000,
        vat_rate: 0.19,
        price_gross: 5950,
        currency: 'RON',
      },
    ],
  };
}
