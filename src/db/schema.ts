/**
 * Pure Drizzle schema for the invoicing_plugin plugin.
 *
 * This is the sole schema definition. The CMS loads it via the manifest's
 * `dbConfig` and merges the `sqliteTable` exports at build time.
 * Data accessors in `src/lib/data/` import table objects from this file,
 * so they are importable and executable in the real-SQLite test harness
 * outside the Astro build.
 */
import { sqliteTable, text, integer, customType } from 'drizzle-orm/sqlite-core';

/**
 * Date column type: stored as TEXT (ISO 8601 string), converted to/from
 * Date via toISOString / new Date. Used for all timestamp columns.
 */
export const dateType = customType<{
  data: Date;
  driverData: string;
}>({
  dataType() {
    return 'text';
  },
  toDriver(value: Date) {
    return value.toISOString();
  },
  fromDriver(value: string): Date {
    if (!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/.test(value)) {
      value += 'Z';
    }
    return new Date(value);
  },
});

/**
 * Invoices — one row per order (1:1), provider-agnostic.
 *
 * `order_id` is the idempotency key (unique). The full self-contained order
 * payload is stored in `snapshot_json` so the detail page renders without
 * querying shop tables. `series`/`number`/`pdf_link`/`provider_ref`/`error`
 * hold the provider result; status follows the lifecycle
 * received → pending → issued → (storno → storned | cancel → cancelled),
 * with `failed` on emit failure.
 */
export const invoices = sqliteTable('invoices', {
  id: text('id').primaryKey(),
  order_id: text('order_id').notNull().unique(),
  order_number: text('order_number').notNull(),
  customer_name: text('customer_name').notNull(),
  customer_email: text('customer_email'),
  user_id: text('user_id'),
  status: text('status').notNull().default('received'),
  provider: text('provider'),
  snapshot_json: text('snapshot_json').notNull(),
  series: text('series'),
  number: text('number'),
  pdf_link: text('pdf_link'),
  provider_ref: text('provider_ref'),
  error: text('error'),
  issue_date: dateType('issue_date'),
  created_at: dateType('created_at').notNull(),
  updated_at: dateType('updated_at').notNull(),
});

/**
 * Invoice operation logs — the dev-mode audit trail.
 *
 * In dev mode the plugin captures the would-be request (the provider-neutral
 * `InvoiceDraft` for emit/retry, or `{ series, number }` for print/storno/
 * cancel) into one row per trigger, parks the invoice in its non-terminal
 * starting state, and lets the operator decide the outcome from the log
 * detail. `resolution` is `pending` until decided, then `decided` with
 * `success`/`error`/`result_json` and `decided_at` set.
 */
export const invoice_logs = sqliteTable('invoice_logs', {
  id: text('id').primaryKey(),
  invoice_id: text('invoice_id'),
  operation: text('operation').notNull(),
  provider: text('provider'),
  request_json: text('request_json').notNull(),
  from_status: text('from_status').notNull(),
  resolution: text('resolution').notNull().default('pending'),
  success: integer('success', { mode: 'boolean' }),
  error: text('error'),
  result_json: text('result_json'),
  created_at: dateType('created_at').notNull(),
  decided_at: dateType('decided_at'),
});

/**
 * Plugin settings — encrypted key/value pairs for provider credentials.
 * Keys are provider-prefixed (`fgo_cui`, `fgo_private_key`, ...).
 */
export const invoicing_settings = sqliteTable('invoicing_settings', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  value: text('value').notNull(),
  created_at: dateType('created_at').notNull(),
});
