import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ensureLoader } from '../../stubs/register.mjs';
import { makeFakeSdk, makeCtx, unauthorizedError } from '../helpers.ts';
import { createTestDb } from '../../db/harness.ts';
import { createInvoice, setInvoiceStatus, getInvoiceById } from '../../../src/lib/data/invoices.ts';
import { registerProvider } from '../../../src/providers/invoicing/registry.ts';
import type { InvoicingProvider } from '../../../src/providers/invoicing/interface.ts';
import { orderData } from '../../fixtures/order-data.ts';

ensureLoader();
const emit = await import('../../../src/api/invoicing/invoices/[id]/emit.ts');
const print = await import('../../../src/api/invoicing/invoices/[id]/print.ts');
const storno = await import('../../../src/api/invoicing/invoices/[id]/storno.ts');
const cancel = await import('../../../src/api/invoicing/invoices/[id]/cancel.ts');

// register a stubbed provider that the action handlers resolve from the registry
const stubProvider: InvoicingProvider = {
  name: 'stub',
  getConfigSchema: () => ({ requiredKeys: [] }),
  create: async () => ({ success: true, series: 'FGO', number: '5', pdfLink: 'https://pdf' }),
  print: async () => ({ success: true, pdfLink: 'https://pdf-print' }),
  storno: async () => ({ success: true, seriesStorno: 'FGO', numberStorno: '99' }),
  cancel: async () => ({ success: true }),
};
registerProvider(stubProvider);

function payload(orderId: string): ReturnType<typeof orderData> {
  return orderData({ orderId });
}

async function failedInvoice(db: any, orderId: string): Promise<string> {
  const c = await createInvoice(db, { orderId, payload: payload(orderId), provider: 'stub' });
  await setInvoiceStatus(db, c.id, 'failed', { error: 'old' });
  return c.id;
}
async function issuedInvoice(db: any, orderId: string): Promise<string> {
  const c = await createInvoice(db, { orderId, payload: payload(orderId), provider: 'stub' });
  await setInvoiceStatus(db, c.id, 'issued', { series: 'FGO', number: '1', error: null });
  return c.id;
}

describe('POST invoice actions (emit | print | storno | cancel)', () => {
  let db: any;
  beforeEach(async () => {
    const t = await createTestDb();
    db = t.db;
  });

  test('emit (retry): failed → issued, returns {success,data:{invoice}}', async () => {
    const id = await failedInvoice(db, 'a1');
    const res = await emit.runPost({
      db,
      sdk: makeFakeSdk(),
      ctx: makeCtx({ url: 'http://localhost/api', params: { id } }),
    });
    assert.equal(res.status, 200);
    const b = await res.json();
    assert.equal(b.success, true);
    assert.equal(b.data.invoice.status, 'issued');
  });

  test('emit endpoint threads sdk.events.publish into retryInvoice', async () => {
    const id = await failedInvoice(db, 'a7');
    const calls: { event: string; data: Record<string, unknown> }[] = [];
    const sdk = {
      ...makeFakeSdk(),
      events: {
        publish: (event: string, data: Record<string, unknown>) => calls.push({ event, data }),
        subscribe: () => () => {},
      },
    };
    const res = await emit.runPost({
      db,
      sdk,
      ctx: makeCtx({ url: 'http://localhost/api', params: { id } }),
    });
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].event, 'invoicing.invoice.ready');
  });

  test('print: issued → success', async () => {
    const id = await issuedInvoice(db, 'a2');
    const res = await print.runPost({
      db,
      sdk: makeFakeSdk(),
      ctx: makeCtx({ url: 'http://localhost/api', params: { id } }),
    });
    assert.equal(res.status, 200);
    const b = await res.json();
    assert.equal(b.success, true);
    assert.equal(b.data.invoice.status, 'issued');
  });

  test('storno: issued → storned', async () => {
    const id = await issuedInvoice(db, 'a3');
    const res = await storno.runPost({
      db,
      sdk: makeFakeSdk(),
      ctx: makeCtx({ url: 'http://localhost/api', params: { id } }),
    });
    assert.equal(res.status, 200);
    const b = await res.json();
    assert.equal(b.success, true);
    assert.equal(b.data.invoice.status, 'storned');
  });

  test('cancel: issued → cancelled', async () => {
    const id = await issuedInvoice(db, 'a4');
    const res = await cancel.runPost({
      db,
      sdk: makeFakeSdk(),
      ctx: makeCtx({ url: 'http://localhost/api', params: { id } }),
    });
    assert.equal(res.status, 200);
    const b = await res.json();
    assert.equal(b.success, true);
    assert.equal(b.data.invoice.status, 'cancelled');
  });

  test('terminal-state rejection → 4xx + success:false (no provider call)', async () => {
    const id = await issuedInvoice(db, 'a5');
    await setInvoiceStatus(db, id, 'storned', {});
    // cancel on a terminal (storned) invoice must be rejected
    const res = await cancel.runPost({
      db,
      sdk: makeFakeSdk(),
      ctx: makeCtx({ url: 'http://localhost/api', params: { id } }),
    });
    assert.equal(res.status, 400);
    const b = await res.json();
    assert.equal(b.success, false);
    assert.ok(b.error);
  });

  test('retry on non-failed (issued) invoice → 4xx rejection', async () => {
    const id = await issuedInvoice(db, 'a6');
    const res = await emit.runPost({
      db,
      sdk: makeFakeSdk(),
      ctx: makeCtx({ url: 'http://localhost/api', params: { id } }),
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).success, false);
  });

  test('auth-fail → 401 for each action endpoint', async () => {
    const sdk = makeFakeSdk({ authThrows: unauthorizedError() });
    const params = { id: 'x' };
    for (const mod of [emit, print, storno, cancel]) {
      const res = await mod.runPost({
        db,
        sdk,
        ctx: makeCtx({ url: 'http://localhost/api', params }),
      });
      assert.equal(res.status, 401, 'auth-fail must return 401');
      assert.equal((await res.json()).success, false);
    }
  });
});
