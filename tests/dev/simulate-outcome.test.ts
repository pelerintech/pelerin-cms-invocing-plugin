import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestDb } from '../db/harness.ts';
import { captureRequest, simulateOutcome } from '../../src/lib/dev-capture.ts';
import { getDevLog } from '../../src/lib/data/logs.ts';
import { createInvoice, setInvoiceStatus, getInvoiceById } from '../../src/lib/data/invoices.ts';
import { orderData } from '../fixtures/order-data.ts';

async function seedLog(
  db: any,
  opts: { operation: string; fromStatus: string; invoice: { id: string } }
) {
  return captureRequest(db, {
    invoiceId: opts.invoice.id,
    operation: opts.operation,
    provider: 'dev',
    requestJson:
      opts.operation === 'emit' ? { billTo: {}, lines: [] } : { series: 'DEV', number: '1' },
    fromStatus: opts.fromStatus,
  });
}

async function receivedInvoice(db: any, orderId: string) {
  return createInvoice(db, { orderId, payload: orderData({ orderId }), provider: 'dev' });
}
async function failedInvoice(db: any, orderId: string) {
  const c = await createInvoice(db, { orderId, payload: orderData({ orderId }), provider: 'dev' });
  await setInvoiceStatus(db, c.id, 'failed', { error: 'old' });
  return c;
}
async function issuedInvoice(db: any, orderId: string) {
  const c = await createInvoice(db, { orderId, payload: orderData({ orderId }), provider: 'dev' });
  await setInvoiceStatus(db, c.id, 'issued', { series: 'DEV', number: '1', error: null });
  return c;
}

describe('simulateOutcome (dev-mode outcome application)', () => {
  let db: any;
  beforeEach(async () => {
    const t = await createTestDb();
    db = t.db;
  });

  test('emit success → issued with synthetic series/number/pdf, log decided', async () => {
    const inv = await receivedInvoice(db, 's1');
    const log = await seedLog(db, { operation: 'emit', fromStatus: 'received', invoice: inv });
    const res = await simulateOutcome(db, log.id, {
      outcome: 'success',
      series: 'DEV1',
      number: '1',
      pdfLink: 'https://pdf',
    });
    assert.equal(res.ok, true);
    assert.equal(res.status, 'issued');
    const row = await getInvoiceById(db, inv.id);
    assert.equal(row!.status, 'issued');
    assert.equal(row!.series, 'DEV1');
    assert.equal(row!.number, '1');
    assert.equal(row!.pdf_link, 'https://pdf');
    const updated = await getDevLog(db, log.id);
    assert.equal(updated!.resolution, 'decided');
    assert.equal(updated!.success, true);
    assert.ok(updated!.decided_at instanceof Date);
  });

  test('emit failure → failed with error, log success=false', async () => {
    const inv = await receivedInvoice(db, 's2');
    const log = await seedLog(db, { operation: 'emit', fromStatus: 'received', invoice: inv });
    const res = await simulateOutcome(db, log.id, { outcome: 'failure', error: 'FGO rejected' });
    assert.equal(res.ok, true);
    assert.equal(res.status, 'failed');
    const row = await getInvoiceById(db, inv.id);
    assert.equal(row!.status, 'failed');
    assert.equal(row!.error, 'FGO rejected');
    const updated = await getDevLog(db, log.id);
    assert.equal(updated!.success, false);
    assert.equal(updated!.error, 'FGO rejected');
  });

  test('retry failure keeps the failed state (subsequent real retry possible)', async () => {
    const inv = await failedInvoice(db, 's3');
    const log = await seedLog(db, { operation: 'retry', fromStatus: 'failed', invoice: inv });
    const res = await simulateOutcome(db, log.id, { outcome: 'failure', error: 'nope' });
    assert.equal(res.ok, true);
    assert.equal(res.status, 'failed');
    const row = await getInvoiceById(db, inv.id);
    assert.equal(row!.status, 'failed');
    assert.equal(row!.error, 'nope');
  });

  test('print success keeps issued and records pdf_link', async () => {
    const inv = await issuedInvoice(db, 's4');
    const log = await seedLog(db, { operation: 'print', fromStatus: 'issued', invoice: inv });
    const res = await simulateOutcome(db, log.id, {
      outcome: 'success',
      pdfLink: 'https://pdf-print',
    });
    assert.equal(res.ok, true);
    assert.equal(res.status, 'issued');
    const row = await getInvoiceById(db, inv.id);
    assert.equal(row!.status, 'issued');
    assert.equal(row!.pdf_link, 'https://pdf-print');
  });

  test('storno success → storned', async () => {
    const inv = await issuedInvoice(db, 's5');
    const log = await seedLog(db, { operation: 'storno', fromStatus: 'issued', invoice: inv });
    const res = await simulateOutcome(db, log.id, {
      outcome: 'success',
      series: 'DEV',
      number: '99',
    });
    assert.equal(res.ok, true);
    assert.equal(res.status, 'storned');
    const row = await getInvoiceById(db, inv.id);
    assert.equal(row!.status, 'storned');
  });

  test('cancel success → cancelled', async () => {
    const inv = await issuedInvoice(db, 's6');
    const log = await seedLog(db, { operation: 'cancel', fromStatus: 'issued', invoice: inv });
    const res = await simulateOutcome(db, log.id, { outcome: 'success' });
    assert.equal(res.ok, true);
    assert.equal(res.status, 'cancelled');
    const row = await getInvoiceById(db, inv.id);
    assert.equal(row!.status, 'cancelled');
  });

  test('failure for print/storno/cancel leaves issued with error on the log', async () => {
    for (const op of ['print', 'storno', 'cancel']) {
      const inv = await issuedInvoice(db, `s7-${op}`);
      const log = await seedLog(db, { operation: op, fromStatus: 'issued', invoice: inv });
      const res = await simulateOutcome(db, log.id, { outcome: 'failure', error: 'provider down' });
      assert.equal(res.ok, true);
      assert.equal(res.status, 'issued');
      const row = await getInvoiceById(db, inv.id);
      assert.equal(row!.status, 'issued');
      const updated = await getDevLog(db, log.id);
      assert.equal(updated!.success, false);
    }
  });

  test('deciding an already-decided log is rejected', async () => {
    const inv = await receivedInvoice(db, 's8');
    const log = await seedLog(db, { operation: 'emit', fromStatus: 'received', invoice: inv });
    await simulateOutcome(db, log.id, { outcome: 'success', series: 'DV', number: '1' });
    const res = await simulateOutcome(db, log.id, { outcome: 'failure', error: 'x' });
    assert.equal(res.ok, false);
    const row = await getInvoiceById(db, inv.id);
    assert.equal(row!.status, 'issued');
  });

  test('storno success on a non-issued invoice is rejected and unchanged', async () => {
    const inv = await receivedInvoice(db, 's9');
    await setInvoiceStatus(db, inv.id, 'issued', { series: 'DEV', number: '1' });
    // manually force to a non-issued state for the log's invoice
    await setInvoiceStatus(db, inv.id, 'failed', { error: 'x' });
    const log = await seedLog(db, { operation: 'storno', fromStatus: 'failed', invoice: inv });
    const res = await simulateOutcome(db, log.id, { outcome: 'success' });
    assert.equal(res.ok, false);
    const row = await getInvoiceById(db, inv.id);
    assert.equal(row!.status, 'failed');
  });
});
