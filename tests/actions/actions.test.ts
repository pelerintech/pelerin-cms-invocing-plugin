import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestDb } from '../db/harness.ts';
import { createInvoice, setInvoiceStatus, getInvoiceById } from '../../src/lib/data/invoices.ts';
import {
  retryInvoice,
  printInvoice,
  stornoInvoice,
  cancelInvoice,
} from '../../src/lib/action-runner.ts';
import type { InvoicingProvider } from '../../src/providers/invoicing/interface.ts';
import { orderData } from '../fixtures/order-data.ts';

let db: any;

function payload(orderId: string): ReturnType<typeof orderData> {
  return orderData({ orderId });
}

interface Stub {
  calls: Record<string, number>;
  createResult: any;
  printResult: any;
  stornoResult: any;
  cancelResult: any;
  provider: InvoicingProvider;
}

function stub(): Stub {
  const s: Stub = {
    calls: { create: 0, print: 0, storno: 0, cancel: 0 },
    createResult: { success: true, series: 'FGO', number: '10', pdfLink: 'https://pdf' },
    printResult: { success: true, pdfLink: 'https://pdf-print' },
    stornoResult: { success: true, seriesStorno: 'FGO', numberStorno: '99' },
    cancelResult: { success: true },
    provider: {
      name: 'stub',
      getConfigSchema: () => ({ requiredKeys: [] }),
      create: async () => {
        s.calls.create++;
        return s.createResult;
      },
      print: async () => {
        s.calls.print++;
        return s.printResult;
      },
      storno: async () => {
        s.calls.storno++;
        return s.stornoResult;
      },
      cancel: async () => {
        s.calls.cancel++;
        return s.cancelResult;
      },
    } as any,
  };
  return s;
}

async function failedInvoice(orderId: string): Promise<string> {
  const created = await createInvoice(db, { orderId, payload: payload(orderId), provider: 'stub' });
  await setInvoiceStatus(db, created.id, 'failed', { error: 'old error' });
  return created.id;
}

async function issuedInvoice(orderId: string): Promise<string> {
  const created = await createInvoice(db, { orderId, payload: payload(orderId), provider: 'stub' });
  await setInvoiceStatus(db, created.id, 'issued', {
    series: 'FGO',
    number: '42',
    pdf_link: 'https://pdf',
    error: null,
  });
  return created.id;
}

describe('action dispatch (retry / print / storno / cancel)', () => {
  beforeEach(async () => {
    const t = await createTestDb();
    db = t.db;
  });

  // ── retry ──
  test('retryInvoice: failed → issued on provider success, clears error', async () => {
    const s = stub();
    s.createResult = {
      success: true,
      series: 'FGO',
      number: '10',
      pdfLink: 'https://pdf',
      request: { CodUnic: 'RO1' },
      response: { Success: true, Factura: { Numar: '10' } },
    };
    const id = await failedInvoice('o-retry-1');
    const res = await retryInvoice(db, id, s.provider);
    assert.equal(res.ok, true);
    assert.equal(s.calls.create, 1);
    const row = await getInvoiceById(db, id);
    assert.equal(row!.status, 'issued');
    assert.equal(row!.number, '10');
    assert.equal(row!.error, null);
    assert.equal(row!.req_payload, JSON.stringify({ CodUnic: 'RO1' }));
    assert.equal(row!.res_payload, JSON.stringify({ Success: true, Factura: { Numar: '10' } }));
  });

  test('retryInvoice: stays failed with latest error on provider failure', async () => {
    const s = stub();
    s.createResult = {
      success: false,
      error: 'still rejected',
      request: { CodUnic: 'RO1' },
      response: { Success: false, Message: 'still rejected' },
    };
    const id = await failedInvoice('o-retry-2');
    const res = await retryInvoice(db, id, s.provider);
    assert.equal(res.ok, false);
    const row = await getInvoiceById(db, id);
    assert.equal(row!.status, 'failed');
    assert.equal(row!.error, 'still rejected');
    assert.equal(row!.req_payload, JSON.stringify({ CodUnic: 'RO1' }));
    assert.equal(row!.res_payload, JSON.stringify({ Success: false, Message: 'still rejected' }));
  });

  test('retryInvoice: non-failed invoice is rejected without a provider call', async () => {
    const s = stub();
    const id = await issuedInvoice('o-retry-3');
    const res = await retryInvoice(db, id, s.provider);
    assert.equal(res.ok, false);
    assert.equal(s.calls.create, 0, 'no provider call on guard rejection');
  });

  // ── print ──
  test('printInvoice: issued → returns provider pdf link', async () => {
    const s = stub();
    s.printResult = {
      success: true,
      pdfLink: 'https://pdf-print',
      request: { Serie: 'FGO', Numar: '42' },
      response: { Success: true, Factura: { Link: 'https://pdf-print' } },
    };
    const id = await issuedInvoice('o-print-1');
    const res = await printInvoice(db, id, s.provider);
    assert.equal(res.ok, true);
    assert.equal(res.pdfLink, 'https://pdf-print');
    assert.equal(s.calls.print, 1);
    const row = await getInvoiceById(db, id);
    assert.equal(row!.req_payload, JSON.stringify({ Serie: 'FGO', Numar: '42' }));
    assert.equal(
      row!.res_payload,
      JSON.stringify({ Success: true, Factura: { Link: 'https://pdf-print' } })
    );
  });

  test('printInvoice: stores pdfLink if returned and absent', async () => {
    const s = stub();
    const created = await createInvoice(db, {
      orderId: 'o-print-2',
      payload: payload('o-print-2'),
      provider: 'stub',
    });
    // issued but WITHOUT a pdf_link yet
    await setInvoiceStatus(db, created.id, 'issued', {
      series: 'FGO',
      number: '42',
      pdf_link: null,
      error: null,
    });
    await printInvoice(db, created.id, s.provider);
    const row = await getInvoiceById(db, created.id);
    assert.equal(row!.pdf_link, 'https://pdf-print');
  });

  test('printInvoice: terminal invoice rejected without provider call', async () => {
    const s = stub();
    const id = await issuedInvoice('o-print-3');
    await setInvoiceStatus(db, id, 'storned', {});
    const res = await printInvoice(db, id, s.provider);
    assert.equal(res.ok, false);
    assert.equal(s.calls.print, 0);
  });

  // ── storno ──
  test('stornoInvoice: issued → storned (terminal) with storno ref', async () => {
    const s = stub();
    s.stornoResult = {
      success: true,
      seriesStorno: 'FGO',
      numberStorno: '99',
      request: { Serie: 'FGO', Numar: '42' },
      response: { Success: true, Factura: { SerieStorno: 'FGO', NumarStorno: '99' } },
    };
    const id = await issuedInvoice('o-storno-1');
    const res = await stornoInvoice(db, id, s.provider);
    assert.equal(res.ok, true);
    assert.equal(s.calls.storno, 1);
    const row = await getInvoiceById(db, id);
    assert.equal(row!.status, 'storned');
    assert.ok(row!.provider_ref, 'storno reference must be stored');
    assert.equal(row!.req_payload, JSON.stringify({ Serie: 'FGO', Numar: '42' }));
    assert.equal(
      row!.res_payload,
      JSON.stringify({ Success: true, Factura: { SerieStorno: 'FGO', NumarStorno: '99' } })
    );
  });

  test('stornoInvoice: on provider failure status unchanged', async () => {
    const s = stub();
    s.stornoResult = { success: false, error: 'storno refused' };
    const id = await issuedInvoice('o-storno-2');
    const res = await stornoInvoice(db, id, s.provider);
    assert.equal(res.ok, false);
    const row = await getInvoiceById(db, id);
    assert.equal(row!.status, 'issued');
  });

  test('a failing print/storno/cancel persists payload + error but keeps the status', async () => {
    const s = stub();
    s.printResult = {
      success: false,
      error: 'print refused',
      request: { Serie: 'FGO', Numar: '42' },
      response: { Success: false, Message: 'print refused' },
    };
    s.stornoResult = {
      success: false,
      error: 'storno refused',
      request: { Serie: 'FGO', Numar: '42' },
      response: { Success: false, Message: 'storno refused' },
    };
    s.cancelResult = {
      success: false,
      error: 'cancel refused',
      request: { Serie: 'FGO', Numar: '42' },
      response: { Success: false, Message: 'cancel refused' },
    };

    const pid = await issuedInvoice('o-fail-print');
    const pres = await printInvoice(db, pid, s.provider);
    assert.equal(pres.ok, false);
    let row = await getInvoiceById(db, pid);
    assert.equal(row!.status, 'issued', 'print failure must keep the status');
    assert.equal(row!.error, 'print refused');
    assert.equal(row!.req_payload, JSON.stringify({ Serie: 'FGO', Numar: '42' }));
    assert.equal(row!.res_payload, JSON.stringify({ Success: false, Message: 'print refused' }));

    const sid = await issuedInvoice('o-fail-storno');
    const sres = await stornoInvoice(db, sid, s.provider);
    assert.equal(sres.ok, false);
    row = await getInvoiceById(db, sid);
    assert.equal(row!.status, 'issued', 'storno failure must keep the status');
    assert.equal(row!.error, 'storno refused');
    assert.equal(row!.req_payload, JSON.stringify({ Serie: 'FGO', Numar: '42' }));
    assert.equal(row!.res_payload, JSON.stringify({ Success: false, Message: 'storno refused' }));

    const cid = await issuedInvoice('o-fail-cancel');
    const cres = await cancelInvoice(db, cid, s.provider);
    assert.equal(cres.ok, false);
    row = await getInvoiceById(db, cid);
    assert.equal(row!.status, 'issued', 'cancel failure must keep the status');
    assert.equal(row!.error, 'cancel refused');
    assert.equal(row!.req_payload, JSON.stringify({ Serie: 'FGO', Numar: '42' }));
    assert.equal(row!.res_payload, JSON.stringify({ Success: false, Message: 'cancel refused' }));
  });

  test('stornoInvoice: non-issued invoice rejected without provider call', async () => {
    const s = stub();
    const id = await failedInvoice('o-storno-3');
    const res = await stornoInvoice(db, id, s.provider);
    assert.equal(res.ok, false);
    assert.equal(s.calls.storno, 0);
  });

  // ── cancel ──
  test('cancelInvoice: issued → cancelled (terminal)', async () => {
    const s = stub();
    s.cancelResult = {
      success: true,
      request: { Serie: 'FGO', Numar: '42' },
      response: { Success: true },
    };
    const id = await issuedInvoice('o-cancel-1');
    const res = await cancelInvoice(db, id, s.provider);
    assert.equal(res.ok, true);
    assert.equal(s.calls.cancel, 1);
    const row = await getInvoiceById(db, id);
    assert.equal(row!.status, 'cancelled');
    assert.equal(row!.req_payload, JSON.stringify({ Serie: 'FGO', Numar: '42' }));
    assert.equal(row!.res_payload, JSON.stringify({ Success: true }));
  });

  test('cancelInvoice: non-issued invoice rejected without provider call', async () => {
    const s = stub();
    const id = await failedInvoice('o-cancel-2');
    const res = await cancelInvoice(db, id, s.provider);
    assert.equal(res.ok, false);
    assert.equal(s.calls.cancel, 0);
  });
});
