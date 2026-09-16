import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestDb } from '../db/harness.ts';
import { ingestInvoice } from '../../src/lib/dispatch.ts';
import { getInvoiceByOrder, getInvoiceById } from '../../src/lib/data/invoices.ts';
import type { InvoicingProvider } from '../../src/providers/invoicing/interface.ts';
import type { OrderInvoicePayload } from '../../src/lib/order-payload.ts';

/**
 * A realistic ecomm-shaped `data` payload. The bus delivers this as the
 * envelope's `data`; the dispatcher reads order/billing/items from it.
 */
function payload(
  orderId: string,
  overrides: Partial<OrderInvoicePayload> = {}
): OrderInvoicePayload {
  return {
    order: {
      id: orderId,
      order_number: `ORD-${orderId}`,
      status: 'paid',
      currency: 'RON',
      customer_email: 'ana@x.ro',
      customer_name: 'Ana',
      subtotal_net: 10000,
      vat_total: 1900,
      total: 11900,
      user_id: null,
    },
    billing_address: {
      first_name: 'Ana',
      last_name: 'Popescu',
      address: 'Str. X 1',
      city: 'Bucuresti',
      county: 'B',
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
        price_net: 5000,
        vat_rate: 0.19,
        price_gross: 5950,
        currency: 'RON',
      },
    ],
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

describe('ingestInvoice (idempotent, durable, ecomm order-data shape)', () => {
  let db: any;
  beforeEach(async () => {
    const t = await createTestDb();
    db = t.db;
  });

  test('new order → row created with orderId/snapshot from data.order, then issued on provider success', async () => {
    const stub = stubProvider({
      success: true,
      series: 'FGO',
      number: '1',
      pdfLink: 'https://pdf',
      request: { CodUnic: 'RO1', Hash: 'ABC' },
      response: { Success: true, Factura: { Serie: 'FGO', Numar: '1' } },
    });
    const res = await ingestInvoice(db, payload('o-1'), stub.provider);
    assert.equal(res.status, 'issued');

    const row = await getInvoiceByOrder(db, 'o-1');
    assert.ok(row);
    assert.equal(row.status, 'issued');
    assert.equal(row.series, 'FGO');
    assert.equal(row.number, '1');
    assert.equal(row.pdf_link, 'https://pdf');
    assert.equal(row.req_payload, JSON.stringify({ CodUnic: 'RO1', Hash: 'ABC' }));
    assert.equal(
      row.res_payload,
      JSON.stringify({ Success: true, Factura: { Serie: 'FGO', Numar: '1' } })
    );
    // Durable row fields derive from the new ecomm shape.
    assert.equal(row.order_id, 'o-1');
    assert.equal(row.order_number, 'ORD-o-1');
    assert.equal(row.customer_name, 'SC Exemplu SRL');
    assert.equal(row.customer_email, 'ana@x.ro');
    assert.equal(row.snapshot.order.id, 'o-1');
    assert.equal(row.snapshot.order.currency, 'RON');
    assert.equal(stub.calls, 1);
  });

  test('provider failure → row retained as failed with error (nothing lost)', async () => {
    const stub = stubProvider({
      success: false,
      error: 'Rejected by FGO',
      request: { CodUnic: 'RO1' },
      response: { Success: false, Message: 'Rejected by FGO' },
    });
    const res = await ingestInvoice(db, payload('o-2'), stub.provider);
    assert.equal(res.status, 'failed');

    const row = await getInvoiceByOrder(db, 'o-2');
    assert.ok(row, 'row must still exist after failure');
    assert.equal(row.status, 'failed');
    assert.equal(row.error, 'Rejected by FGO');
    assert.equal(row.req_payload, JSON.stringify({ CodUnic: 'RO1' }));
    assert.equal(row.res_payload, JSON.stringify({ Success: false, Message: 'Rejected by FGO' }));
    assert.equal(stub.calls, 1);
  });

  test('no provider credentials → status failed with a credential error', async () => {
    // No injected provider: resolve the real `fgo` from the registry; it needs
    // fgo_* credentials which aren't set → durable `failed`.
    const res = await ingestInvoice(db, payload('o-cred'));
    assert.equal(res.status, 'failed');
    const row = await getInvoiceByOrder(db, 'o-cred');
    assert.ok(row);
    assert.equal(row.status, 'failed');
    assert.ok(/credential/i.test(row.error || ''), `expected credential error, got: ${row.error}`);
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
      payload('o-3', { order: { ...payload('o-3').order, customer_name: 'Changed' } }),
      stub.provider
    );
    assert.equal(res.status, 'issued');
    assert.equal(stub.calls, 1, 'frozen re-process must not call the provider');
    const row = await getInvoiceByOrder(db, 'o-3');
    assert.equal(row.customer_name, 'SC Exemplu SRL', 'frozen snapshot must be untouched');
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
      payload('o-4', { order: { ...payload('o-4').order, customer_name: 'Refreshed' } }),
      stub.provider
    );
    assert.equal(res.status, 'issued');
    assert.equal(stub.calls, 2);

    const row = await getInvoiceByOrder(db, 'o-4');
    assert.equal(row.status, 'issued');
    assert.equal(row.number, '9');
    assert.equal(row.error, null, 'error must be cleared on success');
  });

  test('idempotent: created row is retrievable by id', async () => {
    const stub = stubProvider({
      success: true,
      series: 'FGO',
      number: '7',
      pdfLink: 'https://pdf7',
    });
    const res = await ingestInvoice(db, payload('o-5'), stub.provider);
    const row = await getInvoiceById(db, res.id!);
    assert.ok(row);
    assert.equal(row.order_id, 'o-5');
  });
});
