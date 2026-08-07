/**
 * Stub for the `pelerin:plugin-sdk` virtual module, used ONLY by the Node
 * unit-test loader so handler files are importable. The `createPluginContext`
 * export is never exercised in tests — refactored handlers' `runMethod`
 * functions receive `sdk` as an injected `HandlerDeps` parameter (a fake from
 * tests/api/helpers.ts), and the thin wrapper that calls `createPluginContext()`
 * is never invoked by unit tests.
 */
const dummySdk = {
  auth: {
    requireAdmin: async () => null,
    getUser: async () => null,
  },
};
export function createPluginContext() {
  return dummySdk;
}
