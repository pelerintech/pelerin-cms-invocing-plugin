import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestDb } from '../db/harness.ts';
import { captureRequest } from '../../src/lib/dev-capture.ts';
import { listDevLogs } from '../../src/lib/data/logs.ts';
import { getInvoiceById } from '../../src/lib/data/invoices.ts';
import { createInvoice } from '../../src/lib/data/invoices.ts';
import { orderData } from '../fixtures/order-data.ts';

describe('captureRequest helper', () => {
  let db: any;
  beforeEach(async () => {
    const t = await createTestDb();
    db = t.db;
  });

  test('captureRequest writes a pending log and does not mutate the invoice', async () => {
    const inv = await createInvoice(db, { orderId: 'c1', payload: orderData({ orderId: 'c1' }) });

    const log = await captureRequest(db, {
      invoiceId: inv.id,
      operation: 'emit',
      provider: 'dev',
      requestJson: { billTo: { name: 'X' }, lines: [] },
      fromStatus: 'received',
    });

    assert.ok(log.id);
    assert.equal(log.resolution, 'pending');
    assert.equal(log.success, null);
    assert.equal(log.decided_at, null);

    const logs = await listDevLogs(db, { page: 1, pageSize: 20 });
    assert.equal(logs.total, 1);
    assert.equal(logs.data[0].resolution, 'pending');

    // invoice not mutated (still received)
    const row = await getInvoiceById(db, inv.id);
    assert.equal(row!.status, 'received');
    assert.equal(row!.series, null);
    assert.equal(row!.number, null);
  });
});
