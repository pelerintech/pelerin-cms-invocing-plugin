/**
 * Storno an invoice.
 *
 * POST /api/plugins/invoicing/invoices/[id]/storno
 * Reverses an `issued` invoice → `storned` (terminal).
 */
import type { HandlerDeps } from '../../../../lib/handler-types';
import { stornoInvoice } from '../../../../lib/action-runner.ts';
import { runAction, makeWrapper } from '../../action-handler';

export const POST = makeWrapper(runPost);

export async function runPost(deps: HandlerDeps): Promise<Response> {
  return runAction(deps, (db, id) => stornoInvoice(db, id));
}
