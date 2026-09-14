import { test } from 'node:test';
import assert from 'node:assert';
import { invoice_logs } from '../../src/db/schema.ts';

test('invoice_logs table is defined', () => {
  assert.ok(invoice_logs, 'invoice_logs must be exported from src/db/schema.ts');
});

test('invoice_logs has the expected columns', () => {
  const cols = Object.values((invoice_logs as any)[Symbol.for('drizzle:Columns')] ?? {});
  const names = cols.map((c: any) => c.name);
  for (const expected of [
    'id',
    'invoice_id',
    'operation',
    'provider',
    'request_json',
    'from_status',
    'resolution',
    'success',
    'error',
    'result_json',
    'created_at',
    'decided_at',
  ]) {
    assert.ok(names.includes(expected), `invoice_logs must have column '${expected}'`);
  }
});
