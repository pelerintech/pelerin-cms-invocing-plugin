/**
 * Logs list API endpoint.
 *
 * GET /api/plugins/invoicing/logs
 * Query params: page, pageSize, operation, resolution
 * Returns `{ success: true, data, total, page, pageSize }` newest-first.
 *
 * Uses the unified `runMethod({ db, sdk, ctx })` injection seam — auth, query
 * parsing, accessor calls, and Response construction all live inside `runGet`.
 * The thin `GET` wrapper sources `db` from `createPluginContext().db`.
 */
import type { APIRoute } from 'astro';
import { createPluginContext } from 'pelerin:plugin-sdk';
import type { HandlerDeps } from '../../../lib/handler-types';
import { toDb } from '../../../lib/handler-types';
import { listDevLogs } from '../../../lib/data/logs.ts';

export const GET: APIRoute = (context) => {
  const sdk = createPluginContext();
  return runGet({ db: toDb(sdk.db), sdk, ctx: context });
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function runGet({ db, sdk, ctx }: HandlerDeps): Promise<Response> {
  try {
    await sdk.auth.requireAdmin(ctx.request);
    const url = new URL(ctx.request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(url.searchParams.get('pageSize') || '20', 10))
    );
    const operation = url.searchParams.get('operation') || undefined;
    const resolution = url.searchParams.get('resolution') || undefined;

    const result = await listDevLogs(db, { page, pageSize, operation, resolution });
    return json({ success: true, data: result.data, total: result.total, page, pageSize }, 200);
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    const message = err instanceof Error ? err.message : 'Server Error';
    return json({ success: false, error: message || 'Server Error' }, status);
  }
}
