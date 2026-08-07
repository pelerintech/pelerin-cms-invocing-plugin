/**
 * Providers list API endpoint.
 *
 * GET /api/plugins/invoicing/providers
 * Returns the registered invoicing providers with their configured status.
 */
import type { APIRoute } from 'astro';
import { createPluginContext } from 'pelerin:plugin-sdk';
import type { HandlerDeps } from '../../../lib/handler-types';
import { toDb } from '../../../lib/handler-types';
import { listProviders, listProviderObjects } from '../../../providers/invoicing/registry.ts';
import { isProviderConfigured } from '../../../lib/data/providers.ts';
import '../../../providers/invoicing/index.ts'; // trigger provider auto-registration

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
    listProviders(); // ensure registry evaluated
    const providers = listProviderObjects();
    const result = [];
    for (const p of providers) {
      result.push({ name: p.name, configured: await isProviderConfigured(db, p.name) });
    }
    return json({ success: true, data: { providers: result } }, 200);
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    const message = err instanceof Error ? err.message : 'Server Error';
    return json({ success: false, error: message || 'Server Error' }, status);
  }
}
