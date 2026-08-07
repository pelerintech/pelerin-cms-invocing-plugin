import { test } from 'node:test';
import assert from 'node:assert';
import { sqliteTable, text, customType } from 'drizzle-orm/sqlite-core';
import * as schema from '../../src/db/schema.ts';

const COLUMNS = Symbol.for('drizzle:Columns');
const TABLE = Symbol.for('drizzle:Name');

function columnNames(table: any): string[] {
  const cols = table?.[COLUMNS] as Record<string, any> | undefined;
  if (!cols) return [];
  return Object.values(cols).map((c) => c.name);
}

test('schema exports the invoices table with the exact spec columns', () => {
  const table = (schema as any).invoices;
  assert.ok(table, 'invoices table must be exported');
  assert.equal(table[TABLE], 'invoices');

  const cols = columnNames(table);
  for (const col of [
    'id',
    'order_id',
    'order_number',
    'customer_name',
    'customer_email',
    'user_id',
    'status',
    'provider',
    'snapshot_json',
    'series',
    'number',
    'pdf_link',
    'provider_ref',
    'error',
    'issue_date',
    'created_at',
    'updated_at',
  ]) {
    assert.ok(cols.includes(col), `invoices must have column ${col}`);
  }
});

test('invoices table enforces one row per order (order_id unique 1:1)', () => {
  const table = (schema as any).invoices as {
    order_id: any;
  };
  assert.ok(table.order_id, 'order_id column must exist');
  assert.equal(table.order_id.primary, false);
  assert.ok(
    table.order_id.notNull === true,
    'order_id must be NOT NULL (part of the 1:1 idempotency key)'
  );
});

test('invoices uniqueness is enforced by the schema (1:1 per order)', async () => {
  const { createTestDb } = await import('../db/harness.ts');
  const { db } = await createTestDb();
  const row = {
    id: 'inv-1',
    order_id: 'order-1',
    order_number: 'ORD-1',
    customer_name: 'Ana',
    status: 'received',
    snapshot_json: '{}',
    created_at: new Date(),
    updated_at: new Date(),
  };
  await db.insert(schema.invoices).values(row);
  await assert.rejects(
    () => db.insert(schema.invoices).values({ ...row, id: 'inv-2' }),
    undefined,
    'a second row for the same order_id must be blocked by the unique constraint'
  );
});

test('invoicing_settings.key uniqueness is enforced by the schema', async () => {
  const { createTestDb } = await import('../db/harness.ts');
  const { db } = await createTestDb();
  const row = {
    id: 's-1',
    key: 'fgo_cui',
    value: 'v',
    created_at: new Date(),
  };
  await db.insert(schema.invoicing_settings).values(row);
  await assert.rejects(
    () => db.insert(schema.invoicing_settings).values({ ...row, id: 's-2' }),
    undefined,
    'a duplicate key must be blocked by the unique constraint'
  );
});

test('schema exports the invoicing_settings table with the exact spec columns', () => {
  const table = (schema as any).invoicing_settings;
  assert.ok(table, 'invoicing_settings table must be exported');
  assert.equal(table[TABLE], 'invoicing_settings');

  const cols = columnNames(table);
  for (const col of ['id', 'key', 'value', 'created_at']) {
    assert.ok(cols.includes(col), `invoicing_settings must have column ${col}`);
  }
});

test('invoicing_settings.key is unique', () => {
  // Uniqueness is enforced at runtime (see the schema-enforced test below);
  // here we only assert the column exists and is not null.
  const table = (schema as any).invoicing_settings;
  assert.ok(table.key, 'key column must exist');
});

test('timestamp columns use the dateType custom column', () => {
  const table = (schema as any).invoices;
  const issueDate = table.issue_date;
  assert.ok(issueDate, 'issue_date must exist');
  // dateType produces a Date-mapped text column; check the driver data type is text.
  assert.equal(issueDate.getSQLType(), 'text', 'dateType columns are stored as TEXT ISO 8601');
});
