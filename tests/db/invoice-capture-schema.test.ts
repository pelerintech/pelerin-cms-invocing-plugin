import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { sql } from 'drizzle-orm';
import { createTestDb } from './harness.ts';

/**
 * Real-call observability: the `invoices` table persists the exact outbound
 * provider payload (`req_payload`) and the provider response (`res_payload`).
 * These are the debug source for a failing FGO hash — see the capture spec.
 */
describe('invoices capture columns', () => {
  let db: any;
  beforeEach(async () => {
    const t = await createTestDb();
    db = t.db;
  });

  test('the invoices table declares nullable req_payload and res_payload text columns', async () => {
    const res = await db.run(sql.raw('PRAGMA table_info(invoices)'));
    const cols = (res.rows ?? res).map((r: any) => r.name);
    assert.ok(cols.includes('req_payload'), 'invoices must have a req_payload column');
    assert.ok(cols.includes('res_payload'), 'invoices must have a res_payload column');
  });
});
