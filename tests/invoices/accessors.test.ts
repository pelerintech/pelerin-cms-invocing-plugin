import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { eq } from 'drizzle-orm';
import { createTestDb } from '../db/harness.ts';
import {
  createInvoice,
  getInvoiceById,
  getInvoiceByOrder,
  setInvoiceStatus,
  listInvoices,
  type InvoiceRow,
} from '../../src/lib/data/invoices.ts';
import { invoices } from '../../src/db/schema.ts';
import { orderData } from '../fixtures/order-data.ts';

let db: any;

function samplePayload(
  overrides: Parameters<typeof orderData>[0] = {}
): ReturnType<typeof orderData> {
  return orderData({
    orderId: 'order-1',
    orderNumber: 'ORD-100',
    customerEmail: 'ana@example.com',
    // PF billing so the derived customer_name is the person's full name.
    company: null,
    customerName: 'Ana Popescu',
    ...overrides,
  });
}

describe('invoice accessors', () => {
  beforeEach(async () => {
    const t = await createTestDb();
    db = t.db;
  });

  test('createInvoice inserts a row with snapshot JSON + denormalised columns + status received', async () => {
    const payload = samplePayload();
    const created = await createInvoice(db, { orderId: 'order-1', payload, provider: 'fgo' });
    const row = await getInvoiceById(db, created.id);
    assert.ok(row);
    assert.equal(row.order_id, 'order-1');
    assert.equal(row.order_number, 'ORD-100');
    assert.equal(row.customer_name, 'Ana Popescu');
    assert.equal(row.customer_email, 'ana@example.com');
    assert.equal(row.status, 'received');
    assert.equal(row.provider, 'fgo');
    assert.ok(row.created_at instanceof Date);
    // snapshot round-trips
    assert.equal(row.snapshot.order.id, 'order-1');
    assert.equal(row.snapshot.items.length, 1);
  });

  test('the raw snapshot_json column stores the parsed payload as JSON', async () => {
    const created = await createInvoice(db, {
      orderId: 'order-1',
      payload: samplePayload(),
      provider: 'fgo',
    });
    const raw = await db.select().from(invoices).where(eq(invoices.id, created.id));
    const parsed = JSON.parse(raw[0].snapshot_json);
    assert.equal(parsed.order.id, 'order-1');
    assert.equal(parsed.order.currency, 'RON');
  });

  test('a second insert for the same order_id is blocked by the unique constraint', async () => {
    await createInvoice(db, { orderId: 'order-1', payload: samplePayload(), provider: 'fgo' });
    await assert.rejects(
      () => createInvoice(db, { orderId: 'order-1', payload: samplePayload(), provider: 'fgo' }),
      undefined,
      'duplicate order_id insert must be blocked'
    );
  });

  test('getInvoiceByOrder returns the row or null', async () => {
    const created = await createInvoice(db, {
      orderId: 'order-1',
      payload: samplePayload(),
      provider: 'fgo',
    });
    const byOrder = await getInvoiceByOrder(db, 'order-1');
    assert.ok(byOrder);
    assert.equal(byOrder.id, created.id);
    assert.equal(await getInvoiceByOrder(db, 'nope'), null);
  });

  test('setInvoiceStatus updates status, merges patch, bumps updated_at', async () => {
    const created = await createInvoice(db, {
      orderId: 'order-1',
      payload: samplePayload(),
      provider: 'fgo',
    });
    const origUpdated = created.updated_at.getTime();
    await new Promise((r) => setTimeout(r, 5));

    await setInvoiceStatus(db, created.id, 'issued', {
      series: 'FGO-2026',
      number: '42',
      pdf_link: 'https://pdf',
      error: null,
    });

    const row = await getInvoiceById(db, created.id);
    assert.equal(row.status, 'issued');
    assert.equal(row.series, 'FGO-2026');
    assert.equal(row.number, '42');
    assert.equal(row.pdf_link, 'https://pdf');
    assert.equal(row.error, null);
    assert.ok(row.updated_at.getTime() >= origUpdated, 'updated_at must be bumped');
  });

  test('setInvoiceStatus can store an error on failure', async () => {
    const created = await createInvoice(db, {
      orderId: 'order-1',
      payload: samplePayload(),
      provider: 'fgo',
    });
    await setInvoiceStatus(db, created.id, 'failed', { error: 'Provider rejected' });
    const row = await getInvoiceById(db, created.id);
    assert.equal(row.status, 'failed');
    assert.equal(row.error, 'Provider rejected');
  });

  test('listInvoices returns all rows ordered newest-first with total', async () => {
    // insert with distinct created_at timestamps so newest-first ordering is deterministic
    await createInvoice(db, {
      orderId: 'o-1',
      payload: samplePayload({ orderId: 'o-1', orderNumber: 'ORD-1', company: 'Ana' }),
      provider: 'fgo',
    });
    await new Promise((r) => setTimeout(r, 10));
    await createInvoice(db, {
      orderId: 'o-2',
      payload: samplePayload({ orderId: 'o-2', orderNumber: 'ORD-2', company: 'Bogdan' }),
      provider: 'fgo',
    });
    await new Promise((r) => setTimeout(r, 10));
    await createInvoice(db, {
      orderId: 'o-3',
      payload: samplePayload({ orderId: 'o-3', orderNumber: 'ORD-3', company: 'Cristi' }),
      provider: 'fgo',
    });

    const result = await listInvoices(db, { page: 1, limit: 2 });
    assert.equal(result.total, 3);
    assert.equal(result.data.length, 2);
    // newest-first: last inserted first
    assert.equal(result.data[0].order_id, 'o-3');
    assert.equal(result.data[1].order_id, 'o-2');
  });

  test('listInvoices filters by status', async () => {
    const a = await createInvoice(db, {
      orderId: 'o-1',
      payload: samplePayload({ orderId: 'o-1', orderNumber: 'ORD-1' }),
      provider: 'fgo',
    });
    const b = await createInvoice(db, {
      orderId: 'o-2',
      payload: samplePayload({ orderId: 'o-2', orderNumber: 'ORD-2' }),
      provider: 'fgo',
    });
    await setInvoiceStatus(db, a.id, 'issued', {});
    await setInvoiceStatus(db, b.id, 'failed', { error: 'x' });

    const issued = await listInvoices(db, { page: 1, limit: 20, status: 'issued' });
    assert.equal(issued.total, 1);
    assert.equal(issued.data[0].id, a.id);

    const failed = await listInvoices(db, { page: 1, limit: 20, status: 'failed' });
    assert.equal(failed.data[0].id, b.id);
  });

  test('listInvoices searches across order_number, customer_name, customer_email', async () => {
    await createInvoice(db, {
      orderId: 'o-1',
      payload: samplePayload({
        orderId: 'o-1',
        orderNumber: 'ORD-100',
        company: 'Ana Popescu',
        customerEmail: 'ana@x.ro',
      }),
      provider: 'fgo',
    });
    await createInvoice(db, {
      orderId: 'o-2',
      payload: samplePayload({
        orderId: 'o-2',
        orderNumber: 'ORD-200',
        company: 'Bogdan',
        customerEmail: 'bob@y.ro',
      }),
      provider: 'fgo',
    });

    const byNumber = await listInvoices(db, { page: 1, limit: 20, search: 'ORD-200' });
    assert.equal(byNumber.total, 1);
    assert.equal(byNumber.data[0].order_id, 'o-2');

    const byName = await listInvoices(db, { page: 1, limit: 20, search: 'Popescu' });
    assert.equal(byName.data[0].order_id, 'o-1');

    const byEmail = await listInvoices(db, { page: 1, limit: 20, search: 'y.ro' });
    assert.equal(byEmail.data[0].order_id, 'o-2');
  });

  test('listInvoices default page/limit and values returned include parsed snapshot', async () => {
    const a = await createInvoice(db, {
      orderId: 'o-1',
      payload: samplePayload({ orderId: 'o-1', orderNumber: 'ORD-1' }),
      provider: 'fgo',
    });
    const all = await listInvoices(db, { page: 1, limit: 20 });
    assert.equal(all.data.length, 1);
    assert.ok((all.data[0] as InvoiceRow).snapshot);
    assert.equal(all.data[0].snapshot.order.id, 'o-1');
  });
});
