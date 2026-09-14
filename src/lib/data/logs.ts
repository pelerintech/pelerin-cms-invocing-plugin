/**
 * `invoice_logs` data accessors — the dev-mode audit trail.
 *
 * A captured operation is written as a `pending` log row; the operator later
 * decides its outcome, which merges `success`/`error`/`result_json`,
 * flips `resolution` to `decided`, and sets `decided_at`. Pure Drizzle
 * functions, `db` injected as the first parameter (the AGENTS.md pattern).
 */
import { eq, and, desc, count } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import { invoice_logs } from '../../db/schema.ts';

/** A dev log row as returned by accessors. */
export interface DevLogRow {
  id: string;
  invoice_id: string | null;
  operation: string;
  provider: string | null;
  request_json: string;
  from_status: string;
  resolution: string;
  success: boolean | null;
  error: string | null;
  result_json: string | null;
  created_at: Date;
  decided_at: Date | null;
}

export interface CreateDevLogInput {
  invoiceId: string | null;
  operation: string;
  provider: string | null;
  requestJson: unknown;
  fromStatus: string;
}

export interface ListDevLogsOptions {
  page: number;
  pageSize: number;
  operation?: string;
  resolution?: string;
}

export interface ListDevLogsResult {
  data: DevLogRow[];
  total: number;
}

export interface SetDevLogOutcomeInput {
  success?: boolean;
  error?: string | null;
  resultJson?: unknown;
}

type DbRow = Record<string, unknown>;

function toDevLogRow(row: DbRow): DevLogRow {
  return row as unknown as DevLogRow;
}

/** Insert a pending dev log row (a captured request awaiting an outcome). */
export async function createDevLog(
  db: LibSQLDatabase,
  input: CreateDevLogInput
): Promise<DevLogRow> {
  const now = new Date();
  const row = {
    id: crypto.randomUUID(),
    invoice_id: input.invoiceId ?? null,
    operation: input.operation,
    provider: input.provider ?? null,
    request_json: JSON.stringify(input.requestJson),
    from_status: input.fromStatus,
    resolution: 'pending',
    success: null,
    error: null,
    result_json: null,
    created_at: now,
    decided_at: null,
  };
  const inserted = await db.insert(invoice_logs).values(row).returning();
  return toDevLogRow(inserted[0] as unknown as DbRow);
}

/** Get a single dev log by id, or null if not found. */
export async function getDevLog(db: LibSQLDatabase, id: string): Promise<DevLogRow | null> {
  const rows = await db.select().from(invoice_logs).where(eq(invoice_logs.id, id));
  const row = rows[0] as unknown as DbRow | undefined;
  return row ? toDevLogRow(row) : null;
}

/** List dev logs newest-first with filters + pagination. */
export async function listDevLogs(
  db: LibSQLDatabase,
  opts: ListDevLogsOptions
): Promise<ListDevLogsResult> {
  const conditions = [];
  if (opts.operation) {
    conditions.push(eq(invoice_logs.operation, opts.operation));
  }
  if (opts.resolution) {
    conditions.push(eq(invoice_logs.resolution, opts.resolution));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const limit = Math.max(1, opts.pageSize || 20);
  const page = Math.max(1, opts.page || 1);
  const offset = (page - 1) * limit;

  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(invoice_logs)
      .$dynamic()
      .where(where)
      .orderBy(desc(invoice_logs.created_at))
      .limit(limit)
      .offset(offset),
    db.select({ n: count() }).from(invoice_logs).$dynamic().where(where),
  ]);

  return {
    data: (rows as unknown as DbRow[]).map(toDevLogRow),
    total: Number((totalRows[0] as { n: number }).n),
  };
}

/** Merge-patch a dev log's outcome (success/error/result_json, decided). */
export async function setDevLogOutcome(
  db: LibSQLDatabase,
  id: string,
  input: SetDevLogOutcomeInput
): Promise<DevLogRow> {
  const patch: Record<string, unknown> = {
    resolution: 'decided',
    decided_at: new Date(),
  };
  if (input.success !== undefined) patch.success = input.success;
  if (input.error !== undefined) patch.error = input.error ?? null;
  if (input.resultJson !== undefined) patch.result_json = JSON.stringify(input.resultJson);
  const updated = await db
    .update(invoice_logs)
    .set(patch)
    .where(eq(invoice_logs.id, id))
    .returning();
  return toDevLogRow(updated[0] as unknown as DbRow);
}
