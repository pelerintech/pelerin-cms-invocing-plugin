import { test, describe } from 'node:test';
import assert from 'node:assert';
import { buildInvoiceDraft } from '../../src/providers/invoicing/draft.ts';
import type { OrderInvoicePayload } from '../../src/lib/order-payload.ts';

function samplePayload(): OrderInvoicePayload {
  return {
    orderId: 'order-42',
    orderNumber: 'ORD-42',
    currency: 'RON',
    customer: { name: 'Ana Popescu', email: 'ana@example.com', phone: '0711' },
    billing: {
      name: 'Ana Popescu',
      company: 'SC Exemplu SRL',
      vatNumber: 'RO12345678',
      address: 'Str. X 1',
      city: 'Bucuresti',
      county: 'B',
      country: 'RO',
      email: 'ana@example.com',
      phone: '0711',
    },
    items: [
      {
        name: 'Widget',
        code: 'W-1',
        quantity: 2,
        unit: 'buc',
        unitPriceNet: 100,
        vatRate: 0.19,
        vatIncluded: false,
      },
      {
        name: 'Gadget',
        code: 'G-9',
        quantity: 1,
        unit: 'buc',
        unitPriceNet: 50,
        vatRate: 0.09,
        vatIncluded: false,
      },
    ],
    totals: { currency: 'RON', subtotalNet: 250, vatTotal: 37.5, total: 287.5 },
  };
}

describe('buildInvoiceDraft', () => {
  test('maps externalOrderId, currency, issueDate, lines from the payload', () => {
    const draft = buildInvoiceDraft(samplePayload(), { issueDate: '2026-08-06' });
    assert.equal(draft.externalOrderId, 'order-42');
    assert.equal(draft.currency, 'RON');
    assert.equal(draft.issueDate, '2026-08-06');
    assert.equal(draft.lines.length, 2);
    assert.equal(draft.lines[0].name, 'Widget');
    assert.equal(draft.lines[0].code, 'W-1');
    assert.equal(draft.lines[0].quantity, 2);
    assert.equal(draft.lines[0].unitPriceNet, 100);
    assert.equal(draft.lines[0].vatRate, 0.19);
    assert.equal(draft.lines[0].vatIncluded, false);
    assert.equal(draft.lines[1].vatRate, 0.09);
  });

  test('billTo derives PJ (company) from company + VAT number', () => {
    const draft = buildInvoiceDraft(samplePayload(), { issueDate: '2026-08-06' });
    assert.equal(draft.billTo.name, 'SC Exemplu SRL');
    assert.equal(draft.billTo.fiscalCode, 'RO12345678');
    assert.equal(draft.billTo.vatPayer, true);
    assert.equal(draft.billTo.address, 'Str. X 1');
    assert.equal(draft.billTo.city, 'Bucuresti');
    assert.equal(draft.billTo.county, 'B');
    assert.equal(draft.billTo.country, 'RO');
    assert.equal(draft.billTo.email, 'ana@example.com');
    assert.equal(draft.billTo.phone, '0711');
  });

  test('billTo derives PF (no company) from customer name with vatPayer false', () => {
    const p = samplePayload();
    p.billing.company = undefined;
    p.billing.vatNumber = undefined;
    const draft = buildInvoiceDraft(p, { issueDate: '2026-08-06' });
    assert.equal(draft.billTo.name, 'Ana Popescu');
    assert.equal(draft.billTo.vatPayer, false);
  });

  test('issueDate defaults to today (ISO date) when not provided', () => {
    const today = new Date().toISOString().slice(0, 10);
    const draft = buildInvoiceDraft(samplePayload());
    assert.equal(draft.issueDate, today);
  });

  test('draft is provider-independent (no provider fields leak)', () => {
    const draft = buildInvoiceDraft(samplePayload(), { issueDate: '2026-08-06' });
    const json = JSON.stringify(draft);
    assert.ok(!json.includes('Series'), 'no provider field should leak');
    assert.ok(!json.includes('Hash'), 'no provider field should leak');
    assert.equal(draft.seriesName, undefined, 'seriesName left for provider/config');
  });

  test('deterministic: same fixed payload + fixed clock yields equal drafts', () => {
    const a = buildInvoiceDraft(samplePayload(), { issueDate: '2026-08-06' });
    const b = buildInvoiceDraft(samplePayload(), { issueDate: '2026-08-06' });
    assert.deepEqual(a, b);
  });

  test('line count, quantities, net prices, VAT rates match the payload items', () => {
    const p = samplePayload();
    const draft = buildInvoiceDraft(p, { issueDate: '2026-08-06' });
    assert.equal(draft.lines.length, p.items.length);
    for (let i = 0; i < p.items.length; i++) {
      assert.equal(draft.lines[i].quantity, p.items[i].quantity);
      assert.equal(draft.lines[i].unitPriceNet, p.items[i].unitPriceNet);
      assert.equal(draft.lines[i].vatRate, p.items[i].vatRate);
    }
  });
});
