/**
 * Logs detail API endpoint.
 *
 * GET /api/plugins/invoicing/logs/[id]
 * Returns one log with `request_json`/`result_json` parsed, or 404.
 *
 * Uses the unified `runMethod({ db, sdk, ctx })` injection seam.
 */
import type { APIRoute } from 'astro';
import { createPluginContext } from 'pelerin:plugin-sdk';
import type { HandlerDeps } from '../../../../lib/handler-types';
import { toDb } from '../../../../lib/handler-types';
import { getDevLog, type DevLogRow } from '../../../../lib/data/logs.ts';

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

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function toLogDetail(log: DevLogRow) {
  return {
    ...log,
    request_json: parseJson(log.request_json),
    result_json: parseJson(log.result_json),
  };
}

export async function runGet({ db, sdk, ctx }: HandlerDeps): Promise<Response> {
  try {
    await sdk.auth.requireAdmin(ctx.request);
    const id = ctx.params.id;
    if (!id) {
      return json({ success: false, error: 'Log id is required' }, 400);
    }
    const log = await getDevLog(db, id);
    if (!log) {
      return json({ success: false, error: 'Log not found' }, 404);
    }
    return json({ success: true, data: toLogDetail(log) }, 200);
  } catch (err) {
    const status = (err as { status?: number })?.status ?? 500;
    const message = err instanceof Error ? err.message : 'Server Error';
    return json({ success: false, error: message || 'Server Error' }, status);
  }
}
