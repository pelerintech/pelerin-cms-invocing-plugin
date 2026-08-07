import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestDb } from '../db/harness.ts';
import { ingestInvoice } from '../../src/lib/dispatch.ts';
import { getInvoiceByOrder, getInvoiceById } from '../../src/lib/data/invoices.ts';
import type { InvoicingProvider } from '../../src/providers/invoicing/interface.ts';
import type { OrderInvoicePayload } from '../../src/lib/order-payload.ts';

function payload(
  orderId: string,
  overrides: Partial<OrderInvoicePayload> = {}
): OrderInvoicePayload {
  return {
    orderId,
    orderNumber: `ORD-${orderId}`,
    currency: 'RON',
    customer: { name: 'Ana', email: 'ana@x.ro' },
    billing: { name: 'Ana', address: 'X', city: 'B', country: 'RO' },
    items: [{ name: 'Widget', quantity: 1, unitPriceNet: 100, vatRate: 0.19, vatIncluded: false }],
    totals: { currency: 'RON', subtotalNet: 100, vatTotal: 19, total: 119 },
    ...overrides,
  };
}

interface StubState {
  calls: number;
  result: any;
  provider: InvoicingProvider;
}

function stubProvider(result: any): StubState {
  const state: StubState = {
    calls: 0,
    result,
    provider: {
      name: 'fgo-stub',
      getConfigSchema: () => ({ requiredKeys: [] }),
      create: async () => {
        state.calls++;
        return state.result;
      },
      print: async () => ({ success: true }),
      cancel: async () => ({ success: true }),
      storno: async () => ({ success: true }),
    } as any,
  };
  return state;
}

describe('ingestInvoice (idempotent, durable)', () => {
  let db: any;
  beforeEach(async () => {
    const t = await createTestDb();
    db = t.db;
  });

  test('new order → row created then issued on provider success', async () => {
    const stub = stubProvider({
      success: true,
      series: 'FGO',
      number: '1',
      pdfLink: 'https://pdf',
    });
    const res = await ingestInvoice(db, payload('o-1'), stub.provider);
    assert.equal(res.status, 'issued');

    const row = await getInvoiceByOrder(db, 'o-1');
    assert.ok(row);
    assert.equal(row.status, 'issued');
    assert.equal(row.series, 'FGO');
    assert.equal(row.number, '1');
    assert.equal(row.pdf_link, 'https://pdf');
    assert.equal(row.order_number, 'ORD-o-1');
    assert.equal(row.customer_name, 'Ana');
    assert.equal(stub.calls, 1);
  });

  test('provider failure → row retained as failed with error (nothing lost)', async () => {
    const stub = stubProvider({ success: false, error: 'Rejected by FGO' });
    const res = await ingestInvoice(db, payload('o-2'), stub.provider);
    assert.equal(res.status, 'failed');

    const row = await getInvoiceByOrder(db, 'o-2');
    assert.ok(row, 'row must still exist after failure');
    assert.equal(row.status, 'failed');
    assert.equal(row.error, 'Rejected by FGO');
    assert.equal(stub.calls, 1);
  });

  test('duplicate issued re-process → no new row, no provider call (frozen)', async () => {
    const stub = stubProvider({
      success: true,
      series: 'FGO',
      number: '1',
      pdfLink: 'https://pdf',
    });
    await ingestInvoice(db, payload('o-3'), stub.provider);
    assert.equal((await getInvoiceByOrder(db, 'o-3'))!.status, 'issued');

    // Re-process with a DIFFERENT snapshot — must be ignored (frozen).
    const res = await ingestInvoice(
      db,
      payload('o-3', { customer: { name: 'Changed' } }),
      stub.provider
    );
    assert.equal(res.status, 'issued');
    assert.equal(stub.calls, 1, 'frozen re-process must not call the provider');
    const row = await getInvoiceByOrder(db, 'o-3');
    assert.equal(row.customer_name, 'Ana', 'frozen snapshot must be untouched');
    assert.equal(row.series, 'FGO');
  });

  test('failed re-process → snapshot refreshed, emit re-attempted → issued', async () => {
    const stub = stubProvider({ success: false, error: 'first failure' });
    await ingestInvoice(db, payload('o-4'), stub.provider);
    assert.equal((await getInvoiceByOrder(db, 'o-4'))!.status, 'failed');
    assert.equal(stub.calls, 1);

    // provider now succeeds; re-ingest same order → re-attempt → issued
    stub.result = { success: true, series: 'FGO', number: '9', pdfLink: 'https://pdf2' };
    const res = await ingestInvoice(
      db,
      payload('o-4', { customer: { name: 'Refreshed' } }),
      stub.provider
    );
    assert.equal(res.status, 'issued');
    assert.equal(stub.calls, 2);

    const row = await getInvoiceByOrder(db, 'o-4');
    assert.equal(row.status, 'issued');
    assert.equal(row.number, '9');
    assert.equal(row.error, null, 'error must be cleared on success');
  });
});
