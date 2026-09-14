import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ensureLoader } from '../../stubs/register.mjs';
import { makeFakeSdk, makeCtx, unauthorizedError } from '../helpers.ts';
import { createTestDb } from '../../db/harness.ts';
import { createDevLog } from '../../../src/lib/data/logs.ts';

ensureLoader();
const listMod = await import('../../../src/api/invoicing/logs/index.ts');
const detailMod = await import('../../../src/api/invoicing/logs/[id]/index.ts');

describe('logs list + detail API endpoints', () => {
  let db: any;
  beforeEach(async () => {
    const t = await createTestDb();
    db = t.db;
  });

  test('GET /logs returns { success, data, total, page, pageSize } newest-first', async () => {
    await createDevLog(db, {
      invoiceId: 'inv-1',
      operation: 'emit',
      provider: 'fgo',
      requestJson: { billTo: { name: 'A' } },
      fromStatus: 'received',
    });
    await createDevLog(db, {
      invoiceId: 'inv-2',
      operation: 'retry',
      provider: 'fgo',
      requestJson: { billTo: { name: 'B' } },
      fromStatus: 'failed',
    });
    const res = await listMod.runGet({
      db,
      sdk: makeFakeSdk(),
      ctx: makeCtx({ url: 'http://localhost/api/plugins/invoicing/logs?page=1&pageSize=20' }),
    });
    assert.equal(res.status, 200);
    const b = await res.json();
    assert.equal(b.success, true);
    assert.equal(b.total, 2);
    assert.equal(b.page, 1);
    assert.equal(b.pageSize, 20);
    assert.equal(b.data.length, 2);
    assert.ok(b.data[0].operation);
    assert.ok(b.data[0].invoice_id);
    assert.ok(b.data[0].resolution);
    assert.ok(b.data[0].created_at);
  });

  test('GET /logs/[id] returns one log with parsed request_json', async () => {
    const log = await createDevLog(db, {
      invoiceId: 'inv-x',
      operation: 'emit',
      provider: 'fgo',
      requestJson: { billTo: { name: 'X' }, lines: [{ name: 'w' }] },
      fromStatus: 'received',
    });
    const res = await detailMod.runGet({
      db,
      sdk: makeFakeSdk(),
      ctx: makeCtx({ url: 'http://localhost/api', params: { id: log.id } }),
    });
    assert.equal(res.status, 200);
    const b = await res.json();
    assert.equal(b.success, true);
    const data = b.data;
    assert.equal(data.id, log.id);
    assert.equal(data.invoice_id, 'inv-x');
    assert.equal(data.operation, 'emit');
    // request_json parsed as an object
    assert.deepEqual(data.request_json, { billTo: { name: 'X' }, lines: [{ name: 'w' }] });
  });

  test('GET /logs/[id] → 404 for unknown id', async () => {
    const res = await detailMod.runGet({
      db,
      sdk: makeFakeSdk(),
      ctx: makeCtx({ url: 'http://localhost/api', params: { id: 'nope' } }),
    });
    assert.equal(res.status, 404);
    const b = await res.json();
    assert.equal(b.success, false);
    assert.equal(b.error, 'Log not found');
  });

  test('unauthenticated → 401 for both list and detail', async () => {
    const sdk = makeFakeSdk({ authThrows: unauthorizedError() });
    const listRes = await listMod.runGet({
      db,
      sdk,
      ctx: makeCtx({ url: 'http://localhost/api/plugins/invoicing/logs' }),
    });
    assert.equal(listRes.status, 401);
    assert.equal((await listRes.json()).success, false);

    const detailRes = await detailMod.runGet({
      db,
      sdk,
      ctx: makeCtx({ url: 'http://localhost/api', params: { id: 'x' } }),
    });
    assert.equal(detailRes.status, 401);
    assert.equal((await detailRes.json()).success, false);
  });
});
