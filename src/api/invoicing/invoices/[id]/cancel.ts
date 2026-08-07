/**
 * Cancel (anulare) an invoice.
 *
 * POST /api/plugins/invoicing/invoices/[id]/cancel
 * Cancels an `issued` invoice → `cancelled` (terminal).
 */
import type { HandlerDeps } from '../../../../lib/handler-types';
import { cancelInvoice } from '../../../../lib/action-runner.ts';
import { runAction, makeWrapper } from '../../action-handler';

export const POST = makeWrapper(runPost);

export async function runPost(deps: HandlerDeps): Promise<Response> {
  return runAction(deps, (db, id) => cancelInvoice(db, id));
}
