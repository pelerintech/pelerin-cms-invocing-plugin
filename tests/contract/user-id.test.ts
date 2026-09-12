import { describe, test } from 'node:test';
import assert from 'node:assert';
import { createTestDb } from '../db/harness.ts';
import { createInvoice, getInvoiceByOrder } from '../../src/lib/data/invoices.ts';
import { ingestInvoice } from '../../src/lib/dispatch.ts';
import { parseSnapshot, type OrderInvoicePayload } from '../../src/lib/order-payload.ts';
import { orderData } from '../fixtures/order-data.ts';

function payload(orderId: string, overrides: { userId?: string | null } = {}): OrderInvoicePayload {
  return orderData({ orderId, ...overrides });
}

function stubProvider() {
  return {
    name: 'fgo-stub',
    getConfigSchema: () => ({ requiredKeys: [] }),
    create: async () => ({ success: true, series: 'FGO', number: '1', pdfLink: 'https://pdf' }),
    print: async () => ({ success: true }),
    cancel: async () => ({ success: true }),
    storno: async () => ({ success: true }),
  } as any;
}

describe('ownership contract — user_id on payload, column, and ingestion', () => {
  test('OrderInvoicePayload carries an optional userId field on order', () => {
    const p: OrderInvoicePayload = orderData({ orderId: 'o-1', userId: 'u-1' });
    assert.equal(p.order.user_id, 'u-1');
  });

  test('parseSnapshot round-trips userId unchanged', () => {
    const raw = JSON.stringify(payload('o-1', { userId: 'u-9' }));
    const parsed = parseSnapshot(raw);
    assert.equal(parsed.order.user_id, 'u-9');
  });

  test('createInvoice persists user_id from payload.order.user_id', async () => {
    const t = await createTestDb();
    try {
      const created = await createInvoice(t.db, {
        orderId: 'o-1',
        payload: payload('o-1', { userId: 'u-1' }),
        provider: 'fgo',
      });
      assert.equal(created.user_id, 'u-1');

      const row = await getInvoiceByOrder(t.db, 'o-1');
      assert.equal(row?.user_id, 'u-1');
    } finally {
      await t.cleanup();
    }
  });

  test('createInvoice stores user_id NULL when payload has no userId', async () => {
    const t = await createTestDb();
    try {
      const created = await createInvoice(t.db, {
        orderId: 'o-2',
        payload: payload('o-2'),
        provider: 'fgo',
      });
      assert.equal(created.user_id, null);

      const row = await getInvoiceByOrder(t.db, 'o-2');
      assert.equal(row?.user_id, null);
    } finally {
      await t.cleanup();
    }
  });

  test('ingestInvoice persists user_id from payload.order.user_id', async () => {
    const t = await createTestDb();
    try {
      const res = await ingestInvoice(
        t.db,
        payload('o-3', { userId: 'u-3' }),
        stubProvider() as any
      );
      assert.equal(res.status, 'issued');
      const row = await getInvoiceByOrder(t.db, 'o-3');
      assert.equal(row?.user_id, 'u-3');
    } finally {
      await t.cleanup();
    }
  });
});
