/**
 * Registers the test loader (tests/stubs/loader.mjs) so handler files can be
 * imported under bare Node. Import this module (or call `ensureLoader()`) from
 * each handler test file before dynamically importing a handler.
 *
 * Idempotent — safe to call from multiple test files in the same process.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const loaderUrl = pathToFileURL(pathResolve(__dirname, 'loader.mjs')).href;

let registered = false;
export function ensureLoader() {
  if (registered) return;
  register(loaderUrl, pathToFileURL(import.meta.url));
  registered = true;
}
