/**
 * Invoices list API endpoint.
 *
 * GET /api/plugins/invoicing/invoices
 * Query params: page, limit, search, status
 * Returns `{ success: true, data: { invoices, total, page, totalPages } }`.
 *
 * Uses the unified `runMethod({ db, sdk, ctx })` injection seam — auth, query
 * parsing, accessor calls, and Response construction all live inside `runGet`.
 */
import type { APIRoute } from 'astro';
import { createPluginContext } from 'pelerin:plugin-sdk';
import type { HandlerDeps } from '../../../lib/handler-types';
import { toDb } from '../../../lib/handler-types';
import { listInvoices } from '../../../lib/data/invoices.ts';

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
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10)));
    const search = url.searchParams.get('search') || undefined;
    const status = url.searchParams.get('status') || undefined;

    const result = await listInvoices(db, { page, limit, search, status });
    const totalPages = Math.max(1, Math.ceil(result.total / limit));
    return json(
      {
        success: true,
        data: { invoices: result.data, total: result.total, page, totalPages },
      },
      200
    );
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    const message = err instanceof Error ? err.message : 'Server Error';
    return json({ success: false, error: message || 'Server Error' }, status);
  }
}
