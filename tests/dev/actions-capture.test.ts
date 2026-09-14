import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestDb } from '../db/harness.ts';
import { createInvoice, setInvoiceStatus, getInvoiceById } from '../../src/lib/data/invoices.ts';
import { listDevLogs } from '../../src/lib/data/logs.ts';
import {
  retryInvoice,
  printInvoice,
  stornoInvoice,
  cancelInvoice,
} from '../../src/lib/action-runner.ts';
import { orderData } from '../fixtures/order-data.ts';
import type { InvoicingProvider } from '../../src/providers/invoicing/interface.ts';

async function failedInvoice(db: any, orderId: string): Promise<string> {
  const c = await createInvoice(db, { orderId, payload: orderData({ orderId }), provider: 'dev' });
  await setInvoiceStatus(db, c.id, 'failed', { error: 'old' });
  return c.id;
}
async function issuedInvoice(db: any, orderId: string): Promise<string> {
  const c = await createInvoice(db, { orderId, payload: orderData({ orderId }), provider: 'dev' });
  await setInvoiceStatus(db, c.id, 'issued', { series: 'DEV', number: '1', error: null });
  return c.id;
}

describe('action-runner in dev mode captures and parks', () => {
  let db: any;
  let calls: Record<string, number>;
  let stub: InvoicingProvider;

  beforeEach(async () => {
    const t = await createTestDb();
    db = t.db;
    calls = { create: 0, print: 0, storno: 0, cancel: 0 };
    stub = {
      name: 'dev-act-stub',
      getConfigSchema: () => ({ requiredKeys: [] }),
      create: async () => {
        calls.create++;
        return { success: true, series: 'FGO', number: '1', pdfLink: 'https://pdf' };
      },
      print: async () => {
        calls.print++;
        return { success: true, pdfLink: 'https://pdf-p' };
      },
      storno: async () => {
        calls.storno++;
        return { success: true, seriesStorno: 'FGO', numberStorno: '99' };
      },
      cancel: async () => {
        calls.cancel++;
        return { success: true };
      },
    } as any;
  });

  test('retry on failed: captured, stays failed, no create call', async () => {
    process.env.INVOICING_DEV_MODE = 'true';
    try {
      const id = await failedInvoice(db, 'r1');
      const res = await retryInvoice(db, id, stub);
      assert.equal(res.ok, true);
      assert.equal(res.status, 'captured');
      assert.ok(res.logId);
      assert.equal(calls.create, 0, 'provider create must not be called in dev mode');
      const row = await getInvoiceById(db, id);
      assert.equal(row!.status, 'failed');
      const logs = await listDevLogs(db, { page: 1, pageSize: 20 });
      assert.equal(logs.total, 1);
      assert.equal(logs.data[0].operation, 'retry');
      assert.equal(logs.data[0].resolution, 'pending');
      assert.equal(logs.data[0].from_status, 'failed');
    } finally {
      delete process.env.INVOICING_DEV_MODE;
    }
  });

  for (const [op, fn, method] of [
    ['print', printInvoice, 'print'],
    ['storno', stornoInvoice, 'storno'],
    ['cancel', cancelInvoice, 'cancel'],
  ] as const) {
    test(`${op} on issued: captured, stays issued, no ${method} call`, async () => {
      process.env.INVOICING_DEV_MODE = 'true';
      try {
        const id = await issuedInvoice(db, `x-${op}`);
        const res = await fn(db, id, stub);
        assert.equal(res.ok, true);
        assert.equal(res.status, 'captured');
        assert.ok(res.logId);
        assert.equal(calls[method], 0, `provider ${method} must not be called in dev mode`);
        const row = await getInvoiceById(db, id);
        assert.equal(row!.status, 'issued');
        const logs = await listDevLogs(db, { page: 1, pageSize: 20 });
        assert.equal(logs.total, 1);
        assert.equal(logs.data[0].operation, op);
        assert.equal(logs.data[0].resolution, 'pending');
        // request_json holds { series, number }
        const req = JSON.parse(logs.data[0].request_json);
        assert.equal(req.series, 'DEV');
        assert.equal(req.number, '1');
      } finally {
        delete process.env.INVOICING_DEV_MODE;
      }
    });
  }
});
