import { test } from 'node:test';
import assert from 'node:assert';
import { sql } from 'drizzle-orm';
import { createTestDb } from './harness.ts';

test('in-memory libSQL DB is built from the plugin schema', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const rows = await db.run(sql`SELECT 1 AS one`);
    assert.ok(rows, 'a trivial query should execute against the built DB');
  } finally {
    await cleanup();
  }
});
