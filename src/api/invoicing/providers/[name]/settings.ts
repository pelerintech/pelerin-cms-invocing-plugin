/**
 * Provider settings API endpoint.
 *
 * GET  /api/plugins/invoicing/providers/[name]/settings — retrieve (masked) values
 * POST /api/plugins/invoicing/providers/[name]/settings — save encrypted credentials
 *
 * Uses AES-256-GCM crypto (`src/lib/crypto.ts`) and the `invoicing_settings`
 * accessor with injected `db`. Password-type fields (per the provider's
 * `getConfigSchema`) are masked in GET responses; POST skips empty values and
 * unchanged mask patterns so pre-filled secrets are not overwritten. Keys not
 * in the provider's config schema are silently skipped.
 */
import type { APIRoute } from 'astro';
import { createPluginContext } from 'pelerin:plugin-sdk';
import type { HandlerDeps } from '../../../../lib/handler-types';
import { toDb } from '../../../../lib/handler-types';
import { encrypt } from '../../../../lib/crypto.ts';
import { setSetting } from '../../../../lib/data/settings.ts';
import { getProviderSettings } from '../../../../lib/data/providers.ts';
import { getProvider } from '../../../../providers/invoicing/registry.ts';
import '../../../../providers/invoicing/index.ts'; // trigger provider auto-registration

export const GET: APIRoute = (context) => {
  const sdk = createPluginContext();
  return runGet({ db: toDb(sdk.db), sdk, ctx: context });
};

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

export async function runGet({ db, sdk, ctx }: HandlerDeps): Promise<Response> {
  try {
    await sdk.auth.requireAdmin(ctx.request);
    const name = ctx.params.name;
    if (!name) return json({ success: false, error: 'Provider name is required' }, 400);
    const provider = getProvider(name);
    if (!provider) return json({ success: false, error: 'Unknown provider' }, 404);
    const data = await getProviderSettings(db, name);
    return json({ success: true, data, provider: name }, 200);
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    const message = err instanceof Error ? err.message : 'Server Error';
    return json({ success: false, error: message || 'Server Error' }, status);
  }
}

export async function runPost({ db, sdk, ctx }: HandlerDeps): Promise<Response> {
  try {
    await sdk.auth.requireAdmin(ctx.request);
    const name = ctx.params.name;
    if (!name) return json({ success: false, error: 'Provider name is required' }, 400);

    const body = await ctx.request.json();
    const provider = getProvider(name);
    if (!provider) return json({ success: false, error: 'Unknown provider' }, 404);

    const fields = provider.getConfigSchema().fields;
    const saved: Record<string, boolean> = {};

    for (const [key, value] of Object.entries(body)) {
      if (!value) continue; // skip empty
      if (typeof value === 'string' && /^\*{4,}.{0,4}$/.test(value)) continue; // unchanged mask
      if (!fields?.[key]) continue; // unknown keys silently skipped
      const encrypted = encrypt(String(value));
      await setSetting(db, key, encrypted);
      saved[key] = true;
    }

    return json({ success: true, data: { provider: name, saved }, message: 'Settings saved' }, 200);
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    const message = err instanceof Error ? err.message : 'Server Error';
    return json({ success: false, error: message || 'Server Error' }, status);
  }
}
