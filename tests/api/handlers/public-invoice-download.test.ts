import { describe, test } from 'node:test';
import assert from 'node:assert';
import { ensureLoader } from '../../stubs/register.mjs';
import { makeFakeSdk, makeCtx } from '../helpers.ts';
import { createTestDb } from '../../db/harness.ts';
import { createInvoice, setInvoiceStatus } from '../../../src/lib/data/invoices.ts';
import type { OrderInvoicePayload } from '../../../src/lib/order-payload.ts';

ensureLoader();
const { runGet } = await import('../../../src/api/invoicing/public/invoices/download.ts');

function payload(orderId: string, userId: string): OrderInvoicePayload {
  return {
    orderId,
    orderNumber: `ORD-${orderId}`,
    currency: 'RON',
    userId,
    customer: { name: 'Ana', email: 'ana@x.ro' },
    billing: { name: 'Ana', email: 'ana@x.ro', address: 'X', city: 'B', country: 'RO' },
    items: [{ name: 'Widget', quantity: 1, unitPriceNet: 100, vatRate: 0.19, vatIncluded: false }],
    totals: { currency: 'RON', subtotalNet: 100, vatTotal: 19, total: 119 },
  };
}

function url(userId: string, orderId: string): string {
  return `http://localhost/api/plugins/invoicing/public/invoices/download?user_id=${userId}&order_id=${orderId}`;
}

const USER = { id: 'u-1', email: 'u1@x.ro' };

async function makeIssuedInvoice(t: any, orderId: string, userId: string) {
  const created = await createInvoice(t.db, {
    orderId,
    payload: payload(orderId, userId),
    provider: 'fgo',
  });
  return setInvoiceStatus(t.db, created.id, 'issued', {
    series: 'FGO',
    number: '1',
    pdf_link: 'https://pdf.example/fgo-1.pdf',
  });
}

describe('runGet (public invoice download/status)', () => {
  test('no session → 401 (getUser-based, not admin)', async () => {
    const res = await runGet({
      db: undefined,
      sdk: makeFakeSdk({ getUserNull: true }),
      ctx: makeCtx({ url: url('u-1', 'o-1') }),
    });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).success, false);
  });

  test('missing user_id or order_id → 422', async () => {
    const sdk = makeFakeSdk({ user: USER });
    const res = await runGet({
      db: undefined,
      sdk,
      ctx: makeCtx({ url: 'http://localhost/x' }),
    });
    assert.equal(res.status, 422);
    assert.equal((await res.json()).success, false);
  });

  test('session id ≠ user_id param → 403', async () => {
    const sdk = makeFakeSdk({ user: USER });
    const res = await runGet({
      db: undefined,
      sdk,
      ctx: makeCtx({ url: url('someone-else', 'o-1') }),
    });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).success, false);
  });

  test('no invoice row for order_id → 404 issued:false', async () => {
    const t = await createTestDb();
    try {
      const sdk = makeFakeSdk({ user: USER });
      const res = await runGet({ db: t.db, sdk, ctx: makeCtx({ url: url('u-1', 'nope') }) });
      assert.equal(res.status, 404);
      const body = await res.json();
      assert.equal(body.success, false);
      assert.equal(body.issued, false);
    } finally {
      await t.cleanup();
    }
  });

  test('invoice user_id ≠ session → 403 (real ownership guard)', async () => {
    const t = await createTestDb();
    try {
      await createInvoice(t.db, {
        orderId: 'o-1',
        payload: payload('o-1', 'u-2'),
        provider: 'fgo',
      });
      const sdk = makeFakeSdk({ user: USER });
      const res = await runGet({ db: t.db, sdk, ctx: makeCtx({ url: url('u-1', 'o-1') }) });
      assert.equal(res.status, 403);
      assert.equal((await res.json()).success, false);
    } finally {
      await t.cleanup();
    }
  });

  test('issued invoice → 200 with issued:true + download url', async () => {
    const t = await createTestDb();
    try {
      await makeIssuedInvoice(t, 'o-1', 'u-1');
      const sdk = makeFakeSdk({ user: USER });
      const res = await runGet({ db: t.db, sdk, ctx: makeCtx({ url: url('u-1', 'o-1') }) });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.deepEqual(body.data, {
        issued: true,
        series: 'FGO',
        number: '1',
        pdfUrl: 'https://pdf.example/fgo-1.pdf',
        status: 'issued',
      });
    } finally {
      await t.cleanup();
    }
  });

  test('non-issued invoice → 200 issued:false with status, no pdfUrl', async () => {
    for (const status of ['pending', 'failed', 'storned', 'cancelled']) {
      const t = await createTestDb();
      try {
        const created = await createInvoice(t.db, {
          orderId: `o-${status}`,
          payload: payload(`o-${status}`, 'u-1'),
          provider: 'fgo',
        });
        await setInvoiceStatus(t.db, created.id, status, {
          series: 'FGO',
          number: '1',
          pdf_link: 'https://pdf.example/x.pdf',
        });
        const sdk = makeFakeSdk({ user: USER });
        const res = await runGet({
          db: t.db,
          sdk,
          ctx: makeCtx({ url: url('u-1', `o-${status}`) }),
        });
        assert.equal(res.status, 200, `status ${status}`);
        const body = await res.json();
        assert.equal(body.success, true);
        assert.deepEqual(body.data, { issued: false, status });
        assert.ok(!('pdfUrl' in body.data), `status ${status} must not expose pdfUrl`);
      } finally {
        await t.cleanup();
      }
    }
  });
});
