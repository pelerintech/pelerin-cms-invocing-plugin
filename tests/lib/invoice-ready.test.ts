import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestDb } from '../db/harness.ts';
import {
  createInvoice,
  setInvoiceStatus,
  getInvoiceById,
  type InvoiceRow,
} from '../../src/lib/data/invoices.ts';
import { publishInvoiceReady, type PublishEvent } from '../../src/lib/invoice-ready.ts';
import type { OrderInvoicePayload } from '../../src/lib/order-payload.ts';

function payload(orderId: string): OrderInvoicePayload {
  return {
    order: {
      id: orderId,
      order_number: `ORD-${orderId}`,
      status: 'paid',
      currency: 'RON',
      customer_email: 'ana@x.ro',
      customer_name: 'Ana',
      subtotal_net: 10000,
      vat_total: 1900,
      total: 11900,
      user_id: null,
    },
    billing_address: {
      first_name: 'Ana',
      last_name: 'Popescu',
      address: 'Str. X 1',
      city: 'Bucuresti',
      county: 'B',
      country: 'RO',
      company: 'SC Exemplu SRL',
      vat_number: 'RO12345678',
    },
    shipping_address: {},
    items: [
      {
        product_name: 'Widget',
        sku: 'W-1',
        quantity: 2,
        price_net: 5000,
        vat_rate: 0.19,
        price_gross: 5950,
        currency: 'RON',
      },
    ],
  };
}

interface Call {
  event: string;
  data: Record<string, unknown>;
}

function makePublisher(): { publish: PublishEvent; calls: Call[] } {
  const calls: Call[] = [];
  const publish: PublishEvent = (event, data) => {
    calls.push({ event, data });
  };
  return { publish, calls };
}

describe('publishInvoiceReady (invoicing.invoice.ready payload + guard)', () => {
  let db: any;
  beforeEach(async () => {
    const t = await createTestDb();
    db = t.db;
  });

  async function issuedWithLink(orderId: string, pdfLink = 'https://pdf'): Promise<InvoiceRow> {
    const created = await createInvoice(db, {
      orderId,
      payload: payload(orderId),
      provider: 'fgo',
    });
    return setInvoiceStatus(db, created.id, 'issued', {
      series: 'FGO',
      number: '7',
      pdf_link: pdfLink,
      error: null,
    });
  }

  test('an issued row with a pdf link publishes invoicing.invoice.ready once with the invoice payload', async () => {
    const row = await issuedWithLink('o-ready-1');
    const { publish, calls } = makePublisher();
    publishInvoiceReady(publish, row);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].event, 'invoicing.invoice.ready');
    const inv = calls[0].data.invoice as Record<string, unknown>;
    assert.equal(inv.id, row.id);
    assert.equal(inv.order_id, 'o-ready-1');
    assert.equal(inv.order_number, 'ORD-o-ready-1');
    assert.equal(inv.customer_name, 'SC Exemplu SRL');
    assert.equal(inv.customer_email, 'ana@x.ro');
    assert.equal(inv.series, 'FGO');
    assert.equal(inv.number, '7');
    assert.equal(inv.pdf_link, 'https://pdf');
  });

  test('a pdf link that is null publishes nothing', async () => {
    const row = await issuedWithLink('o-ready-2', null as unknown as string);
    const { publish, calls } = makePublisher();
    publishInvoiceReady(publish, row);
    assert.equal(calls.length, 0);
  });

  test('a non-issued row publishes nothing', async () => {
    const created = await createInvoice(db, {
      orderId: 'o-ready-3',
      payload: payload('o-ready-3'),
      provider: 'fgo',
    });
    const row = await setInvoiceStatus(db, created.id, 'failed', { error: 'x' });
    const { publish, calls } = makePublisher();
    publishInvoiceReady(publish, row);
    assert.equal(calls.length, 0);
  });

  test('an undefined publish does not throw', async () => {
    const row = await issuedWithLink('o-ready-4');
    assert.doesNotThrow(() => publishInvoiceReady(undefined, row));
  });
});
