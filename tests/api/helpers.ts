/**
 * Test infrastructure for API handler unit tests.
 *
 * Provides fakes for the three `HandlerDeps`:
 *  - `makeFakeSdk()` — a PluginContext-shaped fake whose `auth.requireAdmin`
 *    / `auth.getUser` can be made to throw (auth-fail tests) or resolve
 *    (happy-path / error-wrap tests).
 *  - `makeCtx()` — a fake Astro APIContext with a real `Request` and `params`.
 *  - `poisonDb()` — a Proxy that throws on ANY property access or function call,
 *    used to prove a handler never touched the db (auth-fail) or that the catch
 *    block wraps unexpected errors (error-wrap).
 *
 * Reuses the real-SQLite harness from `tests/db/harness.ts` for happy-path tests.
 */

/** Build an Error with a `.status` property, mirroring the CMS's requireAdmin. */
function authError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

/** A 401 Unauthorized error (no session). */
export function unauthorizedError(): Error {
  return authError('Unauthorized', 401);
}

/** A 403 Forbidden error (authenticated, non-admin / banned). */
export function forbiddenError(): Error {
  return authError('Forbidden', 403);
}

export interface FakeSdkOptions {
  /** If set, requireAdmin throws this error. */
  authThrows?: Error;
  /** If authThrows not set, requireAdmin/getUser resolve to this (default: a stub admin user). */
  user?: any;
  /** If set, auth.getUser resolves to null (no consumer session). Other namespaces unaffected. */
  getUserNull?: boolean;
}

/**
 * Build a fake PluginContext. Only the `auth` namespace is exercised by the
 * plugin's handlers (requireAdmin 94×, getUser 2×); other namespaces are stubs.
 */
export function makeFakeSdk(opts: FakeSdkOptions = {}): any {
  const defaultUser = { id: 'admin-user-1', email: 'admin@example.com', role: 'admin' };
  const user = opts.user === undefined ? defaultUser : opts.user;

  return {
    auth: {
      requireAdmin: async (_req: any) => {
        if (opts.authThrows) throw opts.authThrows;
        return user;
      },
      getUser: async (_req: any) => {
        if (opts.getUserNull) return null;
        if (opts.authThrows) throw opts.authThrows;
        return user;
      },
    },
    collections: {},
    db: undefined,
    storage: {},
    webhooks: { trigger: async () => {} },
  };
}

export interface FakeCtxOptions {
  url?: string;
  method?: string;
  body?: any;
  params?: Record<string, string>;
  headers?: Record<string, string>;
}

/**
 * Build a fake Astro APIContext with a real `Request` (so `.json()` etc. work)
 * and a `params` object for dynamic route segments.
 */
export function makeCtx(opts: FakeCtxOptions = {}): any {
  const hasBody = opts.body !== undefined;
  const method = opts.method ?? (hasBody ? 'POST' : 'GET');
  const url = opts.url ?? 'http://localhost/api';
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };

  let bodyInit: BodyInit | undefined;
  if (hasBody) {
    bodyInit = JSON.stringify(opts.body);
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
  }

  const request = new Request(url, { method, headers, body: bodyInit });
  return {
    request,
    params: { ...(opts.params ?? {}) },
    url: new URL(url),
    site: new URL('http://localhost'),
    cookies: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
    },
    redirect: () => new Response(null, { status: 302 }),
    locals: {},
  };
}

/**
 * A Proxy that throws `Error('poison')` on ANY property access or function call.
 * Used to prove a handler never touched the db (auth-fail: handler returns 401
 * before any db call) or that the catch block wraps unexpected errors (error-
 * wrap: handler reaches a db call, the poison throws, the catch returns 500).
 */
export function poisonDb(): any {
  const thrower = () => {
    throw new Error('poison: db was touched');
  };
  const throwOnAccess = () => {
    throw new Error('poison: db was touched');
  };
  return new Proxy(thrower, {
    get: throwOnAccess,
    apply: thrower,
    construct: thrower,
    has: throwOnAccess,
  });
}
