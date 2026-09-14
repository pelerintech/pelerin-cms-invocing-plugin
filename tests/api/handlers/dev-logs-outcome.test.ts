import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ensureLoader } from '../../stubs/register.mjs';
import { makeFakeSdk, makeCtx, unauthorizedError } from '../helpers.ts';
import { createTestDb } from '../../db/harness.ts';
import { captureRequest } from '../../../src/lib/dev-capture.ts';
import { getDevLog } from '../../../src/lib/data/logs.ts';
import { createInvoice, setInvoiceStatus, getInvoiceById } from '../../../src/lib/data/invoices.ts';
import { orderData } from '../../fixtures/order-data.ts';

ensureLoader();
const outcomeMod = await import('../../../src/api/invoicing/logs/[id]/outcome.ts');

describe('POST /logs/[id]/outcome', () => {
  let db: any;
  beforeEach(async () => {
    const t = await createTestDb();
    db = t.db;
  });

  async function pendingEmitLog() {
    const inv = await createInvoice(db, {
      orderId: 'oc-1',
      payload: orderData({ orderId: 'oc-1' }),
      provider: 'fgo',
    });
    const log = await captureRequest(db, {
      invoiceId: inv.id,
      operation: 'emit',
      provider: 'fgo',
      requestJson: { billTo: { name: 'X' } },
      fromStatus: 'received',
    });
    return { inv, log };
  }

  test('POST outcome success on a pending emit log → invoice issued', async () => {
    const { inv, log } = await pendingEmitLog();
    const res = await outcomeMod.runPost({
      db,
      sdk: makeFakeSdk(),
      ctx: makeCtx({
        url: 'http://localhost/api/logs/x/outcome',
        method: 'POST',
        body: { outcome: 'success', series: 'DEV1', number: '1', pdfLink: 'https://pdf' },
        params: { id: log.id },
      }),
    });
    assert.equal(res.status, 200);
    const b = await res.json();
    assert.equal(b.success, true);
    assert.ok(b.data.invoice);
    assert.equal(b.data.invoice.status, 'issued');
    assert.equal(b.data.invoice.series, 'DEV1');
    assert.equal(b.data.invoice.number, '1');
    assert.ok(b.data.log);
    assert.equal(b.data.log.resolution, 'decided');
    const row = await getInvoiceById(db, inv.id);
    assert.equal(row!.status, 'issued');
  });

  test('body without outcome → 4xx, log stays pending', async () => {
    const { log } = await pendingEmitLog();
    const res = await outcomeMod.runPost({
      db,
      sdk: makeFakeSdk(),
      ctx: makeCtx({
        url: 'http://localhost/api/logs/x/outcome',
        method: 'POST',
        body: {},
        params: { id: log.id },
      }),
    });
    assert.equal(res.status, 400);
    const b = await res.json();
    assert.equal(b.success, false);
    assert.ok(b.error);
    const updated = await getDevLog(db, log.id);
    assert.equal(updated!.resolution, 'pending');
  });

  test('auth-fail → 401', async () => {
    const { log } = await pendingEmitLog();
    const res = await outcomeMod.runPost({
      db,
      sdk: makeFakeSdk({ authThrows: unauthorizedError() }),
      ctx: makeCtx({
        url: 'http://localhost/api/logs/x/outcome',
        method: 'POST',
        body: { outcome: 'success' },
        params: { id: log.id },
      }),
    });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).success, false);
  });

  test('unknown id → 404 { success:false }', async () => {
    const res = await outcomeMod.runPost({
      db,
      sdk: makeFakeSdk(),
      ctx: makeCtx({
        url: 'http://localhost/api/logs/x/outcome',
        method: 'POST',
        body: { outcome: 'success' },
        params: { id: 'nope' },
      }),
    });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).success, false);
  });
});
