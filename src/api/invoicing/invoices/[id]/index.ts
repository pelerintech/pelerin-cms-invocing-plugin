/**
 * Invoice detail API endpoint.
 *
 * GET /api/plugins/invoicing/invoices/[id]
 * Returns the invoice (with parsed snapshot) or 404.
 */
import type { APIRoute } from 'astro';
import { createPluginContext } from 'pelerin:plugin-sdk';
import type { HandlerDeps } from '../../../../lib/handler-types';
import { toDb } from '../../../../lib/handler-types';
import { getInvoiceById } from '../../../../lib/data/invoices.ts';

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
    const id = ctx.params.id;
    if (!id) {
      return json({ success: false, error: 'Invoice id is required' }, 400);
    }
    const invoice = await getInvoiceById(db, id);
    if (!invoice) {
      return json({ success: false, error: 'Invoice not found' }, 404);
    }
    return json({ success: true, data: invoice }, 200);
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    const message = err instanceof Error ? err.message : 'Server Error';
    return json({ success: false, error: message || 'Server Error' }, status);
  }
}
