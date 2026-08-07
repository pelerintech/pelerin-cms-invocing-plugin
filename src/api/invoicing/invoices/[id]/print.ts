/**
 * Print an invoice.
 *
 * POST /api/plugins/invoicing/invoices/[id]/print
 * Returns the PDF link for an `issued` invoice.
 */
import type { HandlerDeps } from '../../../../lib/handler-types';
import { printInvoice } from '../../../../lib/action-runner.ts';
import { runAction, makeWrapper } from '../../action-handler';

export const POST = makeWrapper(runPost);

export async function runPost(deps: HandlerDeps): Promise<Response> {
  return runAction(deps, (db, id) => printInvoice(db, id));
}
