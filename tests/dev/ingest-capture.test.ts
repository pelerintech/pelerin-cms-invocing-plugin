import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestDb } from '../db/harness.ts';
import { ingestInvoice } from '../../src/lib/dispatch.ts';
import { getInvoiceByOrder } from '../../src/lib/data/invoices.ts';
import { listDevLogs } from '../../src/lib/data/logs.ts';
import { orderData } from '../fixtures/order-data.ts';
import type { InvoicingProvider } from '../../src/providers/invoicing/interface.ts';

describe('ingestInvoice in dev mode captures the draft and parks', () => {
  let db: any;
  let stubCalls: number;
  let stub: InvoicingProvider;

  beforeEach(async () => {
    const t = await createTestDb();
    db = t.db;
  });

  test('dev mode: captures the draft, parks at received, no provider call', async () => {
    stubCalls = 0;
    stub = {
      name: 'dev-stub',
      getConfigSchema: () => ({ requiredKeys: [] }),
      create: async () => {
        stubCalls++;
        return { success: true, series: 'FGO', number: '1', pdfLink: 'https://pdf' };
      },
      print: async () => ({ success: true }),
      cancel: async () => ({ success: true }),
      storno: async () => ({ success: true }),
    } as any;

    process.env.INVOICING_DEV_MODE = 'true';
    try {
      const res = await ingestInvoice(db, orderData({ orderId: 'o1' }), stub);
      assert.equal(res.status, 'captured');
      assert.ok(res.logId, 'result must carry a logId');
      assert.equal(res.reprocessed, false);
      assert.equal(res.id, (await getInvoiceByOrder(db, 'o1'))!.id);

      // invoice stays received (no pending, no provider call)
      const row = await getInvoiceByOrder(db, 'o1');
      assert.equal(row!.status, 'received');
      assert.equal(stubCalls, 0, 'provider create must not be called in dev mode');

      // a pending emit log holds the draft
      const logs = await listDevLogs(db, { page: 1, pageSize: 20 });
      assert.equal(logs.total, 1);
      const log = logs.data[0];
      assert.equal(log.operation, 'emit');
      assert.equal(log.resolution, 'pending');
      assert.equal(log.invoice_id, row!.id);
      assert.equal(log.from_status, 'received');
      const req = JSON.parse(log.request_json);
      assert.ok(req.billTo, 'request_json must contain the draft billTo');
      assert.ok(Array.isArray(req.lines), 'request_json must contain the draft lines');
      assert.equal(req.externalOrderId, 'o1');
    } finally {
      delete process.env.INVOICING_DEV_MODE;
    }
  });
});
