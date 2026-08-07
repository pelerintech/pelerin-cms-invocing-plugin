import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { ensureLoader } from '../stubs/register.mjs';
import { createTestDb } from '../db/harness.ts';
import { getInvoiceByOrder } from '../../src/lib/data/invoices.ts';
import type { OrderInvoicePayload } from '../../src/lib/order-payload.ts';

ensureLoader();
const mod = await import('../../src/init.ts');
const init = mod.default;

function payload(orderId: string): OrderInvoicePayload {
  return {
    orderId,
    orderNumber: `ORD-${orderId}`,
    currency: 'RON',
    customer: { name: 'Ana', email: 'ana@x.ro' },
    billing: { name: 'Ana', address: 'X', city: 'B', country: 'RO' },
    items: [{ name: 'Widget', quantity: 1, unitPriceNet: 100, vatRate: 0.19, vatIncluded: false }],
    totals: { currency: 'RON', subtotalNet: 100, vatTotal: 19, total: 119 },
  };
}

interface Captured {
  pattern: string;
  handler: (data: any) => Promise<void>;
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

  test('subscriber delegates to the dispatcher (creates a durable invoice row)', async () => {
    const t = await createTestDb();
    const db = t.db;
    const { ctx, captured } = makeCtx(db);
    init(ctx);

    // No FGO credentials configured → the dispatch records the row as failed
    // (durable) rather than dropping the event.
    await captured.handler({ payload: payload('o-1') });

    const row = await getInvoiceByOrder(db, 'o-1');
    assert.ok(row, 'the dispatcher must have created a row');
    assert.equal(row.status, 'failed');
    assert.ok(/credential/i.test(row.error || ''), `expected credential error, got: ${row.error}`);
  });

  test('subscriber errors are caught (never throw into the bus)', async () => {
    const { ctx, captured } = makeCtx({});
    // db that throws on any access
    const throwDb = new Proxy(() => {}, {
      get: () => {
        throw new Error('db boom');
      },
      apply: () => {
        throw new Error('db boom');
      },
    });
    const { ctx: ctx2, captured: cap2 } = makeCtx(throwDb);
    init(ctx2);
    await assert.doesNotReject(() => cap2.handler({ payload: payload('o-2') }));
  });
});

test('init.ts imports/uses the dispatcher (structural)', () => {
  const src = readFileSync(new URL('../../src/init.ts', import.meta.url), 'utf-8');
  assert.ok(src.includes('ingestInvoice'), 'init.ts should delegate to the dispatcher');
  assert.ok(src.includes('ctx.events.subscribe'), 'init.ts should subscribe via ctx.events');
});
