import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { ensureLoader } from '../stubs/register.mjs';
import { createTestDb } from '../db/harness.ts';
import { getInvoiceByOrder } from '../../src/lib/data/invoices.ts';
import type { OrderInvoicePayload } from '../../src/lib/order-payload.ts';

ensureLoader();
const mod = await import('../../src/init.ts');
const init = mod.default;

/**
 * A realistic ecomm-shaped `data` object (as built by `buildOrderEventData`).
 * The bus wraps this into `{ event, timestamp, data }` and delivers it as the
 * second arg to the subscriber `(event, payload)`.
 */
function orderData(orderId = 'o-1'): OrderInvoicePayload {
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

interface Captured {
  pattern: string;
  handler: (event: string, payload: any) => Promise<void>;
}

function makeCtx(db: any): { ctx: any; captured: Captured } {
  const captured: Captured = { pattern: '', handler: async () => {} };
  const ctx = {
    events: {
      subscribe: (pattern: string, handler: any) => {
        captured.pattern = pattern;
        captured.handler = handler;
        return () => {};
      },
    },
    db,
  };
  return { ctx, captured };
}

describe('init (event subscriber wiring)', () => {
  test('subscribes to shop.order.invoice (not wildcard)', () => {
    const { ctx, captured } = makeCtx({});
    init(ctx);
    assert.equal(captured.pattern, 'shop.order.invoice');
    assert.equal(typeof captured.handler, 'function');
  });

  test('invalid context logs error and does not throw', () => {
    const messages: string[] = [];
    const originalError = console.error;
    console.error = (m: string) => messages.push(m);
    try {
      assert.doesNotThrow(() => init({}));
      assert.ok(messages.some((m) => m.includes('[invoicing]')));
    } finally {
      console.error = originalError;
    }
  });

  test('subscriber is invoked as (event, payload) and passes the envelope data to the dispatcher', async () => {
    const t = await createTestDb();
    const db = t.db;
    const { ctx, captured } = makeCtx(db);
    init(ctx);

    const data = orderData('o-1');
    // The bus delivers (eventName, { event, timestamp, data }).
    await captured.handler('shop.order.invoice', {
      event: 'shop.order.invoice',
      timestamp: new Date().toISOString(),
      data,
    });

    const row = await getInvoiceByOrder(db, 'o-1');
    assert.ok(row, 'the dispatcher must have created a row');
    // The stored snapshot is the envelope's `data` (the ecomm order object),
    // NOT the envelope and NOT a `payload`/`event.payload` node.
    assert.equal(row.snapshot.order.id, 'o-1', 'snapshot must be the envelope data');
    // No FGO credentials configured → the row is durable-`failed`.
    assert.equal(row.status, 'failed');
    assert.ok(/credential/i.test(row.error || ''), `expected credential error, got: ${row.error}`);
  });

  test('missing data is warned + skipped (no dispatch)', async () => {
    const { ctx, captured } = makeCtx({});
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (m: string) => warnings.push(m);
    try {
      init(ctx);
      await captured.handler('shop.order.invoice', {
        event: 'shop.order.invoice',
        timestamp: new Date().toISOString(),
      });
      assert.ok(
        warnings.some((w) => w.includes('[invoicing]')),
        'a warning should be logged'
      );
    } finally {
      console.warn = origWarn;
    }
  });

  test('subscriber errors are caught (never throw into the bus)', async () => {
    const throwDb = new Proxy(() => {}, {
      get: () => {
        throw new Error('db boom');
      },
      apply: () => {
        throw new Error('db boom');
      },
    });
    const { ctx, captured } = makeCtx(throwDb);
    init(ctx);
    await assert.doesNotReject(() =>
      captured.handler('shop.order.invoice', {
        event: 'shop.order.invoice',
        timestamp: new Date().toISOString(),
        data: orderData('o-2'),
      })
    );
  });
});

test('init.ts imports/uses the dispatcher (structural)', () => {
  const src = readFileSync(new URL('../../src/init.ts', import.meta.url), 'utf-8');
  assert.ok(src.includes('ingestInvoice'), 'init.ts should delegate to the dispatcher');
  assert.ok(src.includes('ctx.events.subscribe'), 'init.ts should subscribe via ctx.events');
  // New bus contract: the handler must receive (event, payload) and read payload.data.
  assert.ok(
    /subscribe\(\s*['"]shop\.order\.invoice['"]\s*,\s*(async\s*)?\(event,\s*payload\)/.test(src),
    'init.ts must subscribe with a (event, payload) handler'
  );
  assert.ok(
    !/data\?\.payload|event\?\.payload|\.payload\s*\?\?/.test(src),
    'init.ts must not use the old payload heuristic'
  );
});
