import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestDb } from '../../db/harness.ts';
import {
  createDevLog,
  getDevLog,
  listDevLogs,
  setDevLogOutcome,
} from '../../../src/lib/data/logs.ts';

describe('invoice_logs data accessors', () => {
  let db: any;
  beforeEach(async () => {
    const t = await createTestDb();
    db = t.db;
  });

  test('createDevLog inserts a row and getDevLog reads it back', async () => {
    const log = await createDevLog(db, {
      invoiceId: 'inv-1',
      operation: 'emit',
      provider: 'dev',
      requestJson: { billTo: { name: 'SC Exemplu SRL' }, lines: [] },
      fromStatus: 'received',
    });
    assert.ok(log.id);
    assert.equal(log.operation, 'emit');
    assert.equal(log.resolution, 'pending');
    assert.equal(log.success, null);
    assert.equal(log.error, null);
    assert.equal(log.result_json, null);
    assert.ok(log.created_at instanceof Date);
    assert.equal(log.decided_at, null);

    const read = await getDevLog(db, log.id);
    assert.ok(read);
    assert.equal(read.id, log.id);
    assert.equal(read.invoice_id, 'inv-1');
    assert.equal(read.provider, 'dev');
    assert.equal(
      read.request_json,
      JSON.stringify({ billTo: { name: 'SC Exemplu SRL' }, lines: [] })
    );
  });

  test('listDevLogs returns newest-first with filters and a total', async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (const [i, op] of ['emit', 'retry', 'print'].entries()) {
      await delay(2);
      await createDevLog(db, {
        invoiceId: `inv-${i}`,
        operation: op,
        provider: 'dev',
        requestJson: { n: i },
        fromStatus: op === 'retry' ? 'failed' : 'received',
      });
    }
    const all = await listDevLogs(db, { page: 1, pageSize: 20 });
    assert.equal(all.total, 3);
    assert.equal(all.data.length, 3);
    // newest first (created_at desc)
    assert.equal(all.data[0].operation, 'print');

    const filtered = await listDevLogs(db, { page: 1, pageSize: 20, operation: 'emit' });
    assert.equal(filtered.total, 1);
    assert.equal(filtered.data[0].operation, 'emit');

    const paged = await listDevLogs(db, { page: 2, pageSize: 2 });
    assert.equal(paged.total, 3);
    assert.equal(paged.data.length, 1);
  });

  test('listDevLogs filters by resolution', async () => {
    const log = await createDevLog(db, {
      invoiceId: 'inv-x',
      operation: 'emit',
      provider: 'dev',
      requestJson: {},
      fromStatus: 'received',
    });
    await setDevLogOutcome(db, log.id, { success: true, resultJson: { series: 'DEV1' } });
    const pending = await listDevLogs(db, { page: 1, pageSize: 20, resolution: 'pending' });
    assert.equal(pending.total, 0);
    const decided = await listDevLogs(db, { page: 1, pageSize: 20, resolution: 'decided' });
    assert.equal(decided.total, 1);
  });

  test('setDevLogOutcome merge-patches success/error/result_json/resolution/decided_at', async () => {
    const log = await createDevLog(db, {
      invoiceId: 'inv-y',
      operation: 'emit',
      provider: 'dev',
      requestJson: {},
      fromStatus: 'received',
    });
    const updated = await setDevLogOutcome(db, log.id, {
      success: true,
      resultJson: { series: 'DEV1', number: '1' },
    });
    assert.equal(updated.resolution, 'decided');
    assert.equal(updated.success, true);
    assert.equal(updated.result_json, JSON.stringify({ series: 'DEV1', number: '1' }));
    assert.ok(updated.decided_at instanceof Date);

    // error patched separately
    const updated2 = await setDevLogOutcome(db, log.id, { success: false, error: 'rejected' });
    assert.equal(updated2.success, false);
    assert.equal(updated2.error, 'rejected');
  });
});
