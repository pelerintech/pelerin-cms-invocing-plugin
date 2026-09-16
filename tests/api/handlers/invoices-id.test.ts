import { test, describe } from 'node:test';
import assert from 'node:assert';
import { ensureLoader } from '../../stubs/register.mjs';
import { makeFakeSdk, makeCtx, poisonDb, unauthorizedError } from '../helpers.ts';
import { createTestDb } from '../../db/harness.ts';
import { createInvoice, setInvoiceStatus } from '../../../src/lib/data/invoices.ts';
import { orderData } from '../../fixtures/order-data.ts';

ensureLoader();
const { runGet } = await import('../../../src/api/invoicing/invoices/[id]/index.ts');

function payload(orderId: string): ReturnType<typeof orderData> {
  return orderData({ orderId });
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
      assert.equal(body.data.snapshot.order.id, 'o-1');
      assert.equal(body.data.snapshot.items.length, 1);
    } finally {
      await t.cleanup();
    }
  });

  test('detail returns req_payload and res_payload when set', async () => {
    const t = await createTestDb();
    try {
      const created = await createInvoice(t.db, {
        orderId: 'o-cap',
        payload: payload('o-cap'),
        provider: 'fgo',
      });
      await setInvoiceStatus(t.db, created.id, 'issued', {
        req_payload: JSON.stringify({ CodUnic: 'RO1' }),
        res_payload: JSON.stringify({ Success: true }),
      });
      const res = await runGet({
        db: t.db,
        sdk: makeFakeSdk(),
        ctx: makeCtx({ url: 'http://localhost/api', params: { id: created.id } }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.data.req_payload, JSON.stringify({ CodUnic: 'RO1' }));
      assert.equal(body.data.res_payload, JSON.stringify({ Success: true }));
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
