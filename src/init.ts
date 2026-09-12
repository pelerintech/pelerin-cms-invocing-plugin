/**
 * Event bus subscriber — plugin initialization.
 *
 * This is the ecosystem's first real event subscriber: `manifest.init` invokes
 * this function once the CMS event bus is ready (on first request). It is a
 * THIN wrapper — it subscribes to `shop.order.invoice` and delegates all work
 * to the testable `ingestInvoice` dispatcher. No business logic lives here.
 *
 * Because the bus is fire-and-forget and drops async subscriber errors, any
 * internal failure is caught and logged here so it never throws into the bus;
 * durability is provided by the dispatcher (record-then-emit, `failed` retry).
 */
import { ingestInvoice } from './lib/dispatch.ts';
import type { OrderInvoicePayload } from './lib/order-payload.ts';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';

/** The bus-delivered envelope: `{ event, timestamp, data }`. */
interface BusPayload {
  event: string;
  timestamp: string;
  data: unknown;
}

/** Minimal plugin-init context: only what init consumes. */
interface InitContext {
  db: LibSQLDatabase;
  events: {
    subscribe(
      event: string,
      handler: (event: string, payload: BusPayload) => void | Promise<void>
    ): () => void;
  };
}

/** Plugin initialization — called by the CMS plugin SDK with the plugin context. */
export default function init(ctx: InitContext): void {
  if (!ctx || !ctx.events || typeof ctx.events.subscribe !== 'function') {
    console.error('[invoicing] Invalid plugin context — events.subscribe not available');
    return;
  }

  ctx.events.subscribe('shop.order.invoice', async (event, payload) => {
    try {
      // The bus delivers a self-contained envelope; the invoice payload is its
      // `data` node. No payload/event.payload heuristic — the contract is fixed.
      const data = payload?.data;
      if (!data || typeof data !== 'object') {
        console.warn('[invoicing] Received shop.order.invoice without data');
        return;
      }
      await ingestInvoice(ctx.db, data as unknown as OrderInvoicePayload);
    } catch (err) {
      // Never crash the event bus.
      console.error('[invoicing] Error processing shop.order.invoice:', err);
    }
  });

  console.log('[invoicing] Event bus subscriber initialized');
}
