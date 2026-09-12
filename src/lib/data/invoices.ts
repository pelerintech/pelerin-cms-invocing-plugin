import { eq, and, desc, like, or, count } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import { invoices } from '../../db/schema.ts';
import { parseSnapshot, billingName, type OrderInvoicePayload } from '../order-payload.ts';

/** An invoice row as returned by accessors, with the snapshot parsed. */
export interface InvoiceRow {
  id: string;
  order_id: string;
  order_number: string;
  customer_name: string;
  customer_email: string | null;
  user_id: string | null;
  status: string;
  provider: string | null;
  snapshot_json: string;
  series: string | null;
  number: string | null;
  pdf_link: string | null;
  provider_ref: string | null;
  error: string | null;
  issue_date: Date | null;
  created_at: Date;
  updated_at: Date;
  /** Parsed self-contained order payload (from snapshot_json). */
  snapshot: OrderInvoicePayload;
}

type DbRow = Record<string, unknown>;

function toInvoiceRow(row: DbRow): InvoiceRow {
  return {
    ...(row as unknown as Omit<InvoiceRow, 'snapshot'>),
    snapshot: parseSnapshot(String(row.snapshot_json)),
  } as InvoiceRow;
}

export interface CreateInvoiceInput {
  orderId: string;
  payload: OrderInvoicePayload;
  provider?: string;
}

/**
 * Insert a new invoice row for an order. Throws if an order_id already exists
 * (unique constraint) — callers use this as the 1:1 idempotency guard.
 */
export async function createInvoice(
  db: LibSQLDatabase,
  input: CreateInvoiceInput
): Promise<InvoiceRow> {
  const { orderId, payload, provider } = input;
  const now = new Date();
  const row = {
    id: crypto.randomUUID(),
    order_id: orderId,
    order_number: payload.order.order_number,
    customer_name: billingName(payload.billing_address, payload.order),
    customer_email: payload.order.customer_email || null,
    user_id: payload.order.user_id ?? null,
    status: 'received',
    provider: provider ?? null,
    snapshot_json: JSON.stringify(payload),
    series: null,
    number: null,
    pdf_link: null,
    provider_ref: null,
    error: null,
    issue_date: null,
    created_at: now,
    updated_at: now,
  };
  const inserted = await db.insert(invoices).values(row).returning();
  return toInvoiceRow(inserted[0] as unknown as DbRow);
}

/** Get a single invoice by id, with parsed snapshot, or null. */
export async function getInvoiceById(db: LibSQLDatabase, id: string): Promise<InvoiceRow | null> {
  const rows = await db.select().from(invoices).where(eq(invoices.id, id));
  const row = rows[0] as unknown as DbRow | undefined;
  return row ? toInvoiceRow(row) : null;
}

/** Get a single invoice by order_id (the 1:1 key), or null. */
export async function getInvoiceByOrder(
  db: LibSQLDatabase,
  orderId: string
): Promise<InvoiceRow | null> {
  const rows = await db.select().from(invoices).where(eq(invoices.order_id, orderId));
  const row = rows[0] as unknown as DbRow | undefined;
  return row ? toInvoiceRow(row) : null;
}

/** Patch fields merged by setInvoiceStatus. */
export interface InvoiceStatusPatch {
  series?: string | null;
  number?: string | null;
  pdf_link?: string | null;
  provider_ref?: string | null;
  error?: string | null;
  issue_date?: Date | null;
  provider?: string | null;
  snapshot_json?: string;
}

/**
 * Update an invoice's status, merging the patch fields, and bump updated_at.
 */
export async function setInvoiceStatus(
  db: LibSQLDatabase,
  id: string,
  status: string,
  patch: InvoiceStatusPatch = {}
): Promise<InvoiceRow> {
  const merged = { ...(patch as Record<string, unknown>), status, updated_at: new Date() };
  const updated = await db.update(invoices).set(merged).where(eq(invoices.id, id)).returning();
  return toInvoiceRow(updated[0] as unknown as DbRow);
}

export interface ListInvoicesOptions {
  page: number;
  limit: number;
  search?: string;
  status?: string;
}

export interface ListInvoicesResult {
  data: InvoiceRow[];
  total: number;
}

/** List invoices with filters + pagination, ordered newest-first. */
export async function listInvoices(
  db: LibSQLDatabase,
  opts: ListInvoicesOptions
): Promise<ListInvoicesResult> {
  const conditions = [];
  if (opts.status) {
    conditions.push(eq(invoices.status, opts.status));
  }
  if (opts.search) {
    const pattern = `%${opts.search}%`;
    conditions.push(
      or(
        like(invoices.order_number, pattern),
        like(invoices.customer_name, pattern),
        like(invoices.customer_email, pattern)
      )
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const limit = Math.max(1, opts.limit || 20);
  const page = Math.max(1, opts.page || 1);
  const offset = (page - 1) * limit;

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(invoices)
      .$dynamic()
      .where(where)
      .orderBy(desc(invoices.created_at))
      .limit(limit)
      .offset(offset),
    db.select({ n: count() }).from(invoices).$dynamic().where(where),
  ]);

  const total = Number((totalRows[0] as { n: number }).n);
  return {
    data: (rows as unknown as DbRow[]).map(toInvoiceRow),
    total,
  };
}
