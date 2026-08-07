/**
 * Shared runner for the invoice action endpoints (emit/print/storno/cancel).
 *
 * Each action endpoint is a thin wrapper around `runAction`, which:
 *  - guards with `sdk.auth.requireAdmin`,
 *  - reads the invoice `id` from `ctx.params.id`,
 *  - dispatches the requested action against `src/lib/action-runner.ts`,
 *  - returns `{ success: true, data: { invoice } }` or
 *    `{ success: false, error }` (4xx when the action is not allowed /
 *    the provider rejects it).
 */
import type { APIRoute } from 'astro';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import { createPluginContext } from 'pelerin:plugin-sdk';
import type { HandlerDeps } from '../../lib/handler-types';
import { toDb } from '../../lib/handler-types';
import { getInvoiceById } from '../../lib/data/invoices.ts';
import type { ActionResult } from '../../lib/action-runner.ts';

export type ActionFn = (db: LibSQLDatabase, id: string) => Promise<ActionResult>;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function runAction(
  { db, sdk, ctx }: HandlerDeps,
  action: ActionFn
): Promise<Response> {
  try {
    await sdk.auth.requireAdmin(ctx.request);
    const id = ctx.params.id;
    if (!id) {
      return json({ success: false, error: 'Invoice id is required' }, 400);
    }
    const result = await action(db, id);
    if (!result.ok) {
      return json({ success: false, error: result.error || 'Action failed' }, 400);
    }
    const invoice = await getInvoiceById(db, id);
    return json({ success: true, data: { invoice } }, 200);
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    const message = err instanceof Error ? err.message : 'Server Error';
    return json({ success: false, error: message || 'Server Error' }, status);
  }
}

/** Build the thin Astro wrapper from a runAction-returning function. */
export function makeWrapper(run: (deps: HandlerDeps) => Promise<Response>): APIRoute {
  return (context) => {
    const sdk = createPluginContext();
    return run({ db: toDb(sdk.db), sdk, ctx: context });
  };
}
