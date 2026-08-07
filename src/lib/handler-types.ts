/**
 * Shared types for the API handler injection seam.
 *
 * Every handler exports a `runMethod({ db, sdk, ctx })` function that receives
 * these injected deps. The thin `export const METHOD: APIRoute` wrapper
 * constructs the deps from `createPluginContext()` (the integration seam,
 * not unit-tested); the `runMethod` function is unit-tested with a fake `sdk`,
 * a fake `ctx`, and either a seeded harness `db` or a poison-db proxy.
 */
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { PluginContext } from 'pelerin:plugin-sdk';
import type { APIRoute } from 'astro';

/** Dependency bag injected into every handler's runMethod. */
export interface HandlerDeps {
  db: LibSQLDatabase;
  sdk: PluginContext;
  ctx: Parameters<APIRoute>[0];
}

/**
 * Bridge the CMS SDK's DrizzleDb → LibSQLDatabase types.
 * The CMS SDK's ambient DrizzleDb is a minimal interface; at runtime it IS a
 * full LibSQLDatabase instance, but tsc can't prove compatibility structurally.
 */
export function toDb(raw: unknown): LibSQLDatabase {
  return raw as LibSQLDatabase;
}
