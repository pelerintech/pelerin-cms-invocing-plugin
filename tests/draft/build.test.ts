import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildInvoiceDraft } from '../../src/providers/invoicing/draft.ts';
import type { OrderInvoicePayload } from '../../src/lib/order-payload.ts';

/**
 * An ecomm-shaped `data` payload (as built by `buildOrderEventData`). Money is
 * in MINOR units (bani/cents); `vat_rate` is a fraction.
 */
function ecommData(): OrderInvoicePayload {
  return {
    order: {
      id: 'order-42',
      order_number: 'ORD-42',
      status: 'paid',
      currency: 'RON',
      customer_email: 'ana@example.com',
      customer_name: 'Ana Popescu',
      subtotal_net: 25000,
      vat_total: 3750,
      total: 28750,
      user_id: null,
    },
    billing_address: {
      first_name: 'Ana',
      last_name: 'Popescu',
      address: 'Str. X 1',
      city: 'Bucuresti',
      county: 'B',
      postal_code: '010101',
      country: 'RO',
      company: 'SC Exemplu SRL',
      vat_number: 'RO12345678',
    },
    shipping_address: {},
    items: [
      {
        product_name: 'Widget',
        sku: 'W-1',
        quantity: 2,
        price_net: 10000,
        vat_rate: 0.19,
        price_gross: 11900,
        currency: 'RON',
      },
      {
        product_name: 'Gadget',
        sku: 'G-9',
        quantity: 1,
        price_net: 5000,
        vat_rate: 0.09,
        price_gross: 5450,
        currency: 'RON',
      },
    ],
  };
}

describe('buildInvoiceDraft (ecomm order-data → draft mapping)', () => {
  test('maps externalOrderId, currency, issueDate from data.order', () => {
    const draft = buildInvoiceDraft(ecommData(), { issueDate: '2026-08-06' });
    assert.equal(draft.externalOrderId, 'order-42');
    assert.equal(draft.currency, 'RON');
    assert.equal(draft.issueDate, '2026-08-06');
  });

  test('billTo derives name=company, vatPayer=true, fiscalCode=vat_number (PJ)', () => {
    const draft = buildInvoiceDraft(ecommData(), { issueDate: '2026-08-06' });
    assert.equal(draft.billTo.name, 'SC Exemplu SRL');
    assert.equal(draft.billTo.fiscalCode, 'RO12345678');
    assert.equal(draft.billTo.vatPayer, true);
    assert.equal(draft.billTo.address, 'Str. X 1');
    assert.equal(draft.billTo.city, 'Bucuresti');
    assert.equal(draft.billTo.county, 'B');
    assert.equal(draft.billTo.country, 'RO');
    assert.equal(draft.billTo.email, 'ana@example.com');
  });

  test('billTo derives PF (no company) from billing name with vatPayer false', () => {
    const data = ecommData();
    data.billing_address = {
      first_name: 'Ion',
      last_name: 'Doe',
      address: 'Str. Y 2',
      city: 'Cluj',
      country: 'RO',
      company: null,
      vat_number: null,
    };
    const draft = buildInvoiceDraft(data, { issueDate: '2026-08-06' });
    assert.equal(draft.billTo.name, 'Ion Doe');
    assert.equal(draft.billTo.vatPayer, false);
    assert.equal(draft.billTo.fiscalCode, '');
  });

  test('line items map product_name → name, sku → code, and convert minor→major net + vat rate', () => {
    const draft = buildInvoiceDraft(ecommData(), { issueDate: '2026-08-06' });
    assert.equal(draft.lines.length, 2);
    assert.equal(draft.lines[0].name, 'Widget');
    assert.equal(draft.lines[0].code, 'W-1');
    assert.equal(draft.lines[0].quantity, 2);
    // price_net is minor (10000 bani) → major unit price (100.00).
    assert.equal(draft.lines[0].unitPriceNet, 100);
    assert.equal(draft.lines[0].vatRate, 0.19);
    assert.equal(draft.lines[1].unitPriceNet, 50);
    assert.equal(draft.lines[1].vatRate, 0.09);
  });

  test('is provider-independent (no provider fields leak)', () => {
    const draft = buildInvoiceDraft(ecommData(), { issueDate: '2026-08-06' });
    const json = JSON.stringify(draft);
    assert.ok(!json.includes('Series'), 'no provider field should leak');
    assert.ok(!json.includes('Hash'), 'no provider field should leak');
    assert.equal(draft.seriesName, undefined);
  });
});
