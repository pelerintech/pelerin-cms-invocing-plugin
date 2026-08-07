/**
 * Retry/emit an invoice.
 *
 * POST /api/plugins/invoicing/invoices/[id]/emit
 * Re-emits a `failed` invoice from its stored snapshot.
 */
import type { HandlerDeps } from '../../../../lib/handler-types';
import { retryInvoice } from '../../../../lib/action-runner.ts';
import { runAction, makeWrapper } from '../../action-handler';

export const POST = makeWrapper(runPost);

export async function runPost(deps: HandlerDeps): Promise<Response> {
  return runAction(deps, (db, id) => retryInvoice(db, id));
}
