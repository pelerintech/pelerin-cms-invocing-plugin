/**
 * Logs outcome API endpoint.
 *
 * POST /api/plugins/invoicing/logs/[id]/outcome
 * Body: `{ outcome: 'success' | 'failure', series?, number?, pdfLink?, error? }`
 * Applies the operator's chosen outcome to a captured (pending) dev log,
 * driving the invoice into the resulting state. Returns
 * `{ success: true, data: { invoice, log } }` or `{ success: false, error }`.
 */
import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createPluginContext } from 'pelerin:plugin-sdk';
import type { HandlerDeps } from '../../../../lib/handler-types';
import { toDb } from '../../../../lib/handler-types';
import { simulateOutcome } from '../../../../lib/dev-capture.ts';
import { getDevLog } from '../../../../lib/data/logs.ts';
import { getInvoiceById } from '../../../../lib/data/invoices.ts';

const OutcomeSchema = z.object({
  outcome: z.enum(['success', 'failure']),
  series: z.string().optional(),
  number: z.string().optional(),
  pdfLink: z.string().optional(),
  error: z.string().optional(),
});

export const POST: APIRoute = (context) => {
  const sdk = createPluginContext();
  return runPost({ db: toDb(sdk.db), sdk, ctx: context });
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function runPost({ db, sdk, ctx }: HandlerDeps): Promise<Response> {
  try {
    await sdk.auth.requireAdmin(ctx.request);
    const id = ctx.params.id;
    if (!id) {
      return json({ success: false, error: 'Log id is required' }, 400);
    }

    let body: unknown;
    try {
      body = await ctx.request.json();
    } catch {
      return json({ success: false, error: 'Invalid JSON body' }, 400);
    }
    const parsed = OutcomeSchema.safeParse(body);
    if (!parsed.success) {
      return json({ success: false, error: 'Invalid outcome' }, 400);
    }

    const log = await getDevLog(db, id);
    if (!log) {
      return json({ success: false, error: 'Log not found' }, 404);
    }

    const result = await simulateOutcome(db, id, parsed.data);
    if (!result.ok) {
      return json({ success: false, error: result.error || 'Outcome not allowed' }, 400);
    }

    const invoice =
      result.status && log.invoice_id ? await getInvoiceById(db, log.invoice_id) : null;
    return json({ success: true, data: { invoice, log: result.log ?? null } }, 200);
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    const message = err instanceof Error ? err.message : 'Server Error';
    return json({ success: false, error: message || 'Server Error' }, status);
  }
}
