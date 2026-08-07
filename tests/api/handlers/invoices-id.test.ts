import { test, describe } from 'node:test';
import assert from 'node:assert';
import { ensureLoader } from '../../stubs/register.mjs';
import { makeFakeSdk, makeCtx, poisonDb, unauthorizedError } from '../helpers.ts';
import { createTestDb } from '../../db/harness.ts';
import { createInvoice } from '../../../src/lib/data/invoices.ts';
import type { OrderInvoicePayload } from '../../../src/lib/order-payload.ts';

ensureLoader();
const { runGet } = await import('../../../src/api/invoicing/invoices/[id]/index.ts');

function payload(orderId: string): OrderInvoicePayload {
  return {
    orderId,
    orderNumber: 'ORD-1',
    currency: 'RON',
    customer: { name: 'Ana', email: 'ana@x.ro' },
    billing: { name: 'Ana', email: 'ana@x.ro', address: 'X', city: 'B', country: 'RO' },
    items: [{ name: 'Widget', quantity: 1, unitPriceNet: 100, vatRate: 0.19, vatIncluded: false }],
    totals: { currency: 'RON', subtotalNet: 100, vatTotal: 19, total: 119 },
  };
}

describe('runGet (invoices/[id])', () => {
  test('auth-fail → 401 + poison db untouched', async () => {
    const sdk = makeFakeSdk({ authThrows: unauthorizedError() });
    const ctx = makeCtx({ url: 'http://localhost/api', params: { id: 'abc' } });
    const res = await runGet({ db: poisonDb(), sdk, ctx });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).success, false);
  });

  test('detail returns the invoice with parsed snapshot', async () => {
    const t = await createTestDb();
    try {
      const created = await createInvoice(t.db, {
        orderId: 'o-1',
        payload: payload('o-1'),
        provider: 'fgo',
      });
      const res = await runGet({
        db: t.db,
        sdk: makeFakeSdk(),
        ctx: makeCtx({ url: 'http://localhost/api', params: { id: created.id } }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.id, created.id);
      assert.equal(body.data.snapshot.orderId, 'o-1');
      assert.equal(body.data.snapshot.items.length, 1);
    } finally {
      await t.cleanup();
    }
  });

  test('unknown id → 404', async () => {
    const t = await createTestDb();
    try {
      const res = await runGet({
        db: t.db,
        sdk: makeFakeSdk(),
        ctx: makeCtx({ url: 'http://localhost/api', params: { id: 'does-not-exist' } }),
      });
      assert.equal(res.status, 404);
      assert.equal((await res.json()).success, false);
    } finally {
      await t.cleanup();
    }
  });

  test('error-wrap: poison db → 500', async () => {
    const sdk = makeFakeSdk();
    const ctx = makeCtx({ url: 'http://localhost/api', params: { id: 'abc' } });
    const res = await runGet({ db: poisonDb(), sdk, ctx });
    assert.equal(res.status, 500);
    assert.equal((await res.json()).success, false);
  });
});
