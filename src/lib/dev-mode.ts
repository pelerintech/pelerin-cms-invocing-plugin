/**
 * Dev-mode detection for the invoicing plugin dry-run.
 *
 * When `INVOICING_DEV_MODE === 'true'` the plugin intercepts invoice
 * operations (emit/retry/print/storno/cancel) and captures the would-be
 * request into an `invoice_logs` row instead of calling the provider, so
 * operators can dry-run any flow without credentials or real FGO calls.
 *
 * The CMS loads its `.env` into `import.meta.env`, not `process.env`, so
 * `isDevMode()` prefers `import.meta.env` and falls back to `process.env`
 * (the same precedence `crypto.ts` uses for the encryption key). Only the
 * exact string `'true'` enables dev mode.
 *
 * An optional `EnvSource` can be injected in tests (the precedence logic is
 * not reproducible under bare Node, where `import.meta.env` is undefined) —
 * the same "inject the I/O collaborator" principle used by the SES/SMTP
 * factory seams in notifications.
 */

export interface EnvSource {
  importMeta?: Record<string, string | undefined>;
  process?: NodeJS.ProcessEnv;
}

interface ImportMetaWithEnv {
  env?: Record<string, string | undefined>;
}

/** Resolve whether the plugin is in dev mode. Prefers import.meta.env. */
export function isDevMode(env?: EnvSource): boolean {
  const importMeta = (import.meta as unknown as ImportMetaWithEnv).env;
  const source: EnvSource = env ?? { importMeta, process: process.env };
  const raw = source.importMeta?.INVOICING_DEV_MODE ?? source.process?.INVOICING_DEV_MODE;
  return raw === 'true';
}
