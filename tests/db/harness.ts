/**
 * Real-SQLite test harness for the pelerin_invoicing data accessors.
 *
 * Spins up an in-memory libSQL database, creates all plugin tables from
 * `src/db/schema.ts` (the pure-Drizzle schema), and returns a
 * `LibSQLDatabase` instance that data accessors can query.
 *
 * The `db` returned here is the same Drizzle `LibSQLDatabase` type that
 * the CMS provides in prod, so accessors behave identically in tests and prod.
 */
import { drizzle } from 'drizzle-orm/libsql';
import { sql } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '../../src/db/schema.ts';

const COLUMNS_SYMBOL = Symbol.for('drizzle:Columns');

/** All plugin table objects from the schema module. */
const tables = Object.entries(schema).filter(
  ([, v]) =>
    v && typeof v === 'object' && Object.getOwnPropertySymbols(v).some((s) => s === COLUMNS_SYMBOL)
) as [string, Record<string, any>][];

/**
 * Generate a CREATE TABLE statement from a Drizzle sqliteTable object by
 * introspecting its columns (name, SQL type, notNull, primary).
 */
function createTableSQL(tableName: string, table: Record<string, any>): string {
  const cols = table[COLUMNS_SYMBOL] as Record<string, any>;
  const colDefs = Object.values(cols).map((col: any) => {
    const type = col.getSQLType().toUpperCase();
    let def = `"${col.name}" ${type}`;
    if (col.primary) def += ' PRIMARY KEY';
    if (col.notNull) def += ' NOT NULL';
    return def;
  });
  return `CREATE TABLE "${tableName}" (\n  ${colDefs.join(',\n  ')}\n)`;
}

export interface TestDb {
  db: LibSQLDatabase<typeof schema>;
  cleanup: () => Promise<void>;
}

/**
 * Create a fresh in-memory database with all plugin tables.
 * Each call is isolated — no shared state across tests.
 */
export async function createTestDb(): Promise<TestDb> {
  const db = drizzle(':memory:', { schema });

  for (const [name, table] of tables) {
    await db.run(sql.raw(createTableSQL(name, table)));
  }

  // Add unique indexes that the harness's createTableSQL doesn't introspect
  // (Drizzle table-level constraints are not accessible via COLUMNS_SYMBOL).
  // `invoices.order_id` is the 1:1 idempotency key; `invoicing_settings.key`
  // mirrors the settings upsert semantics. Guarded because these tables only
  // exist after the schema task adds them.
  const uniqueIndexes = [
    ['invoices_order_id_unique', 'invoices', 'order_id'],
    ['invoicing_settings_key_unique', 'invoicing_settings', 'key'],
  ] as const;
  for (const [indexName, table, col] of uniqueIndexes) {
    try {
      await db.run(
        sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS "${indexName}" ON "${table}" ("${col}")`)
      );
    } catch {
      // Table not present yet — schema still being built up.
    }
  }

  const cleanup = async () => {
    // libSQL in-memory client is GC'd; nothing to close explicitly.
  };

  return { db, cleanup };
}

/** Map of table name → table object, for insertFixture. */
const tableByName = Object.fromEntries(tables) as Record<string, Record<string, any>>;

/** Table objects, for FK-safe clear order. */
const tableObjects = tables.map(([, t]) => t);

/** Clear all plugin tables (children before parents). */
export async function resetDb(db: LibSQLDatabase<typeof schema>): Promise<void> {
  for (const table of tableObjects) {
    await db.delete(table);
  }
}

/** Insert a single row into a named table. */
export async function insertFixture(
  db: LibSQLDatabase<typeof schema>,
  tableName: string,
  row: Record<string, any>
): Promise<void> {
  const table = tableByName[tableName];
  if (!table) throw new Error(`Unknown table: ${tableName}`);
  await db.insert(table).values(row);
}

export { schema };
