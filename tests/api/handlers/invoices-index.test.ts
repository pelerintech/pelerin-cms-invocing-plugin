import { test, describe } from 'node:test';
import assert from 'node:assert';
import { ensureLoader } from '../../stubs/register.mjs';
import { makeFakeSdk, makeCtx, poisonDb, unauthorizedError } from '../helpers.ts';
import { createTestDb } from '../../db/harness.ts';
import { createInvoice, setInvoiceStatus } from '../../../src/lib/data/invoices.ts';
import type { OrderInvoicePayload } from '../../../src/lib/order-payload.ts';

ensureLoader();
const { runGet } = await import('../../../src/api/invoicing/invoices/index.ts');

function payload(
  orderId: string,
  name: string,
  email: string,
  number: string
): OrderInvoicePayload {
  return {
    orderId,
    orderNumber: number,
    currency: 'RON',
    customer: { name, email },
    billing: { name, email, address: 'X', city: 'B', country: 'RO' },
    items: [{ name: 'Widget', quantity: 1, unitPriceNet: 100, vatRate: 0.19, vatIncluded: false }],
    totals: { currency: 'RON', subtotalNet: 100, vatTotal: 19, total: 119 },
  };
}

describe('runGet (invoices index)', () => {
  test('auth-fail: requireAdmin throws 401, poison db untouched → 401', async () => {
    const sdk = makeFakeSdk({ authThrows: unauthorizedError() });
    const ctx = makeCtx({ url: 'http://localhost/api/plugins/invoicing/invoices' });
    const res = await runGet({ db: poisonDb(), sdk, ctx });
    assert.equal(res.status, 401);
    const b = await res.json();
    assert.equal(b.success, false);
  });

  test('happy-path: returns {success,data:{invoices,total,page,totalPages}}', async () => {
    const t = await createTestDb();
    try {
      const a = await createInvoice(t.db, {
        orderId: 'o-1',
        payload: payload('o-1', 'Ana', 'ana@x.ro', 'ORD-1'),
        provider: 'fgo',
      });
      const b = await createInvoice(t.db, {
        orderId: 'o-2',
        payload: payload('o-2', 'Bogdan', 'bob@y.ro', 'ORD-2'),
        provider: 'fgo',
      });
      await setInvoiceStatus(t.db, a.id, 'issued', {});
      await setInvoiceStatus(t.db, b.id, 'failed', { error: 'x' });

      const ctx = makeCtx({
        url: 'http://localhost/api/plugins/invoicing/invoices?page=1&limit=20',
      });
      const res = await runGet({ db: t.db, sdk: makeFakeSdk(), ctx });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.data.total, 2);
      assert.equal(body.data.page, 1);
      assert.equal(body.data.totalPages, 1);
      assert.ok(Array.isArray(body.data.invoices));
    } finally {
      await t.cleanup();
    }
  });

  test('filters by status and search', async () => {
    const t = await createTestDb();
    try {
      const a = await createInvoice(t.db, {
        orderId: 'o-1',
        payload: payload('o-1', 'Ana Popescu', 'ana@x.ro', 'ORD-100'),
        provider: 'fgo',
      });
      await setInvoiceStatus(t.db, a.id, 'issued', {});

      const res = await runGet({
        db: t.db,
        sdk: makeFakeSdk(),
        ctx: makeCtx({
          url: 'http://localhost/api/plugins/invoicing/invoices?status=issued&search=Popescu',
        }),
      });
      const body = await res.json();
      assert.equal(body.data.total, 1);
      assert.equal(body.data.invoices[0].order_id, 'o-1');
    } finally {
      await t.cleanup();
    }
  });

  test('error-wrap: poison db, auth passes → 500', async () => {
    const sdk = makeFakeSdk();
    const ctx = makeCtx({ url: 'http://localhost/api/plugins/invoicing/invoices' });
    const res = await runGet({ db: poisonDb(), sdk, ctx });
    assert.equal(res.status, 500);
    const b = await res.json();
    assert.equal(b.success, false);
  });
});
