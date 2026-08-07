/**
 * Public invoice download/status endpoint.
 *
 * GET /api/plugins/invoicing/public/invoices/download?user_id=...&order_id=...
 *
 * The plugin's first public (non-admin) endpoint. A logged-in consumer asks
 * about one of their own orders and gets a shaped response: whether an invoice
 * is actually issued for the order and, when it is, the PDF download URL.
 *
 * Authorisation uses `sdk.auth.getUser` (NOT `requireAdmin`), mirroring the
 * ecomm `public/orders` endpoint. Ownership is proven in two independent steps:
 * the session user must equal the `user_id` param, and the stored invoice's
 * `user_id` must equal the session user. Only an `issued` invoice yields a
 * `pdfUrl`; other states report `issued:false` with their status.
 */
import type { APIRoute } from 'astro';
import { createPluginContext } from 'pelerin:plugin-sdk';
import type { HandlerDeps } from '../../../../lib/handler-types';
import { toDb } from '../../../../lib/handler-types';
import { getInvoiceByOrder } from '../../../../lib/data/invoices.ts';

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
    // 1. Resolve the consumer session (not admin). Without a session → 401.
    let user: { id: string } | null;
    try {
      user = await sdk.auth.getUser(ctx.request);
    } catch {
      return json({ success: false, error: 'Unauthorized' }, 401);
    }
    if (!user) {
      return json({ success: false, error: 'Unauthorized' }, 401);
    }

    // 2. Required params.
    const url = new URL(ctx.request.url);
    const userId = url.searchParams.get('user_id');
    const orderId = url.searchParams.get('order_id');
    if (!userId || !orderId) {
      return json({ success: false, error: 'user_id and order_id are required' }, 422);
    }

    // 3. The caller may not claim another account.
    if (user.id !== userId) {
      return json({ success: false, error: 'Forbidden' }, 403);
    }

    // 4. The order must map to an invoice.
    const invoice = await getInvoiceByOrder(db, orderId);
    if (!invoice) {
      return json({ success: false, issued: false }, 404);
    }

    // 5. The invoice must belong to the session user (real ownership guard).
    if (invoice.user_id !== userId) {
      return json({ success: false, error: 'Forbidden' }, 403);
    }

    // 6. Shaped result — only issued yields a download url.
    if (invoice.status === 'issued') {
      return json(
        {
          success: true,
          data: {
            issued: true,
            series: invoice.series,
            number: invoice.number,
            pdfUrl: invoice.pdf_link,
            status: invoice.status,
          },
        },
        200
      );
    }
    return json({ success: true, data: { issued: false, status: invoice.status } }, 200);
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    const message = err instanceof Error ? err.message : 'Server Error';
    return json({ success: false, error: message || 'Server Error' }, status);
  }
}
