# AGENTS.md — invoicing_plugin

This document is the single source of truth for AI agents working on the `invoicing_plugin` plugin. Read it in full before modifying code.

> **Scaffold status: SUPERSEDED.** The `2026-08-06-invoicing-core` request landed the core feature set: the `invoices` + `invoicing_settings` tables, data accessors, the provider interface/registry with the FGO adapter, `init` event-subscriber wiring (`shop.order.invoice` → ingestion), admin API handlers, and the four admin pages. The patterns below are the landed contract — follow them for all future feature work.

---

## 1. What this project is

`invoicing_plugin` is a **Pelerin CMS plugin**. It does not run standalone. It is attached to a Pelerin CMS instance (symlinked into the CMS's `plugins/invoicing_plugin/` directory and loaded at build time by Pelerin's plugin system).

It is a **generic invoicing plugin**: it consumes order lifecycle events from the ecommerce plugin and emits invoices in an external invoicing system behind a pluggable provider interface. External systems (FGO first, then SmartBill/Oblio) sit behind `src/providers/invoicing/`.

The CMS repo lives at `../pelerin_cms/`. Sibling plugins `../ecomm_plugin/` and `../notifications_plugin/` are the reference implementations for the patterns this plugin follows.

**Locked-in decisions (see `reespec/decisions.md`):**

- Generic invoicing plugin with a provider abstraction; FGO is the first provider (landed).
- Self-contained and event-driven — consumes self-contained order payloads; never queries shop tables directly (no cross-plugin DB access).
- Name / URL namespace: `invoicing_plugin`, `/admin/plugins/invoicing`, `/api/plugins/invoicing`.

---

## 2. Plugin overview (target shape — features deferred)

The end-state flow:

```
┌─────────────┐  order lifecycle  ┌───────────────────┐  provider   ┌─────────────┐
│ ecomm_plugin│─────event────────▶│ invoicing_plugin │────call────▶│ invoicing   │
│  (orders)   │                   │  stores invoice,  │◀──invoice───│ system      │
└─────────────┘                   │  admin table view │             │ (FGO first) │
                                  └───────────────────┘             └─────────────┘
```

Invoices are stored locally and displayed in an admin table filtered by order. **All of this now exists**: the `shop.order.invoice` event subscription (the ecosystem's first event subscriber), the `invoices` + `invoicing_settings` tables, the provider interface/registry, and the admin UI + API.

---

## 3. Plugin manifest (`pelerin.manifest.json`)

`pelerin.manifest.json` is the plugin contract. It is wired for the landed feature:

- `name: invoicing_plugin`, `displayName: "Invoicing"`, `version: 1.0.0`
- `dbConfig: ./src/db/schema.ts`, `dbSeed: ./src/db/seed.ts`, `init: ./src/init.ts`
- `adminPages` — the 4 admin pages (`/admin/plugins/invoicing`, `invoices/[id]`, `settings/providers`, `settings/providers/[name]`)
- `apiEndpoints` — invoices list/detail, the 4 actions (emit/print/storno/cancel), providers list, provider settings
- `navItems` — Invoices + Providers

The CMS validator (`../pelerin_cms/src/lib/plugins/manifest.ts`) requires: `name`, `version`, `displayName` (non-empty strings), `dbConfig` (path string), and the four array fields. All new pages/endpoints stay inside the `/admin/plugins/invoicing` and `/api/plugins/invoicing` namespaces.

---

## 4. Database (`src/db/schema.ts`)

`src/db/schema.ts` is the sole schema definition. It uses pure Drizzle (`sqliteTable` from `drizzle-orm/sqlite-core`). The CMS loads it via the manifest's `dbConfig` and merges the table exports at build time. Data accessors in `src/lib/data/` import table objects from this file, so they are importable and executable in the test harness outside Astro.

**Landed state:** the file exports two tables — `invoices` (id, `order_id` notNull+unique for 1:1 idempotency, order_number, customer_name, customer_email, status, provider, snapshot_json, series, number, pdf_link, provider_ref, error, issue_date, created_at, updated_at — all timestamps use `dateType`) and `invoicing_settings` (id, key unique, value, created_at). Provider credentials are stored (encrypted) as `*_`-prefixed settings rows in `invoicing_settings` (e.g. `fgo_cui`).

**Rules:**

- Table objects are imported from `src/db/schema.ts` — this is the **sole schema definition**.
- **No file other than `src/db/seed.ts` may import from `astro:db`.**
- Statuses: `received · pending · issued · failed · cancelled · storned` (terminal from `issued`; `storned`/`cancelled` terminal).

`src/db/seed.ts` is a **no-op** default async function — invoices/settings are created via the event flow and admin UI, not fixtures.

---

## 5. Data access layer (`src/lib/data/`) — mandatory pattern

**All database access must live in `src/lib/data/` as pure functions that receive `db` as the first parameter.** API endpoints, pages, and init wiring must NOT write queries inline — they call accessor functions and pass the `db` handle.

**Landed accessors** (`src/lib/data/`):

- `invoices.ts` — `createInvoice`, `getInvoiceById`, `getInvoiceByOrder`, `setInvoiceStatus` (merge-patch), `listInvoices` (newest-first, search/status/page/limit).
- `settings.ts` — `getSetting`, `setSetting` (upsert), `listSettingsForProvider`.
- `providers.ts` — `isProviderConfigured`, `getProviderSettings` (masks password values).

Every accessor has tests against the real-SQLite harness.

**Drizzle/libsql quirk:** use `inArray()` for IN clauses — NEVER `sql.raw()` with positional placeholders (produces `near "?": syntax error` in this Drizzle/libsql version).

---

## 6. db injection seam

There are exactly two entry points that obtain a `LibSQLDatabase` and pass it to accessors:

1. **Admin pages** — `sdk.db` from `createPluginContext()` (from `pelerin:plugin-sdk`).
2. **API endpoints** — `const sdk = createPluginContext()` then `runX({ db: sdk.db, sdk, ctx })` (the injected-`db` handler pattern, §7).
3. **Providers** — `db` is injected into provider methods (see §8).

Both pass `db` to accessor functions. No other code obtains `db`.

---

## 7. Endpoint handler pattern (testable HTTP layer)

Each endpoint file exports a `runMethod({ db, sdk, ctx }: HandlerDeps): Promise<Response>` function and a thin Astro wrapper:

- **`runMethod`** (the testable surface) receives `db`/`sdk`/`ctx` as injected deps. Auth (`sdk.auth.requireAdmin`), body/query parsing, zod validation, accessor calls, and full `Response` construction all live INSIDE it. Responses use a `{ success, data }` / `{ success: false, error }` envelope. **Every admin endpoint must call `sdk.auth.requireAdmin(request)`** before doing any work.
- **The wrapper** (`export const POST: APIRoute = (context) => { const sdk = createPluginContext(); return runPost({ db: sdk.db, sdk, ctx: context }); }`) sources `db` from `sdk.db`. It is NOT unit-tested.

Handler modules stay importable under bare Node via a Node ESM loader hook (`tests/stubs/loader.mjs`) that redirects `pelerin:` specifiers to inert stub modules and appends `.ts` to extension-less relative specifiers — this pattern comes from `../notifications_plugin/`.

---

## 8. Plugin SDK — the only CMS surface

Interact with the CMS **only** through `pelerin:plugin-sdk` (virtual module). Do not import CMS internals from `../pelerin_cms/` directly.

```ts
import { createPluginContext } from 'pelerin:plugin-sdk';
const sdk = createPluginContext();
```

- `sdk.auth` — `getUser(req)`, `requireAdmin(req)`, `withAuth(req, handler)`
- `sdk.db` — Drizzle `LibSQLDatabase` (passed to accessors, never queried in pages)
- `sdk.collections`, `sdk.storage`, `sdk.webhooks` — as applicable

Admin pages wrap their content in `AdminLayout` from `pelerin:admin-layout`.

---

## 9. Provider interface & registry (landed)

External invoicing systems sit behind a provider abstraction in `src/providers/invoicing/`, mirroring the **payment provider pattern** in `../ecomm_plugin/src/providers/payment/` (an `interface.ts` + `registry.ts` + one adapter file per provider).

- `interface.ts` — `InvoicingProvider`, `InvoiceDraft`, `ProviderConfigField`/`ProviderConfigSchema`, result types.
- `registry.ts` — `registerProvider` / `getProvider` / `listProviders` / `listProviderObjects`. Register providers ONCE per process/import (`fgo.ts` auto-registers on import).
- `draft.ts` — `buildInvoiceDraft(payload, { issueDate })` canonical draft (PJ if company else PF).
- `fgo.ts` — first provider. FGO-specific quirks (SHA-1 hash auth, `Serie`, `IdExtern` + `VerificareDuplicat`, 1 req/s, 15s timeout) stay inside the adapter. Credentials read from `invoicing_settings` via injected `db`.
- `index.ts` — barrel that imports every adapter to trigger auto-registration.

Provider methods receive injected `db` where they read credentials. Provider config form is generated from `getConfigSchema().fields` (including `select`-type fields like `fgo_environment` test/prod).

## 10 (event wiring) — init → dispatch

`src/init.ts` is the ecosystem's first real event subscriber, wired via the manifest `init` field. It is a THIN wrapper: it subscribes to `shop.order.invoice` and delegates ALL work to `src/lib/dispatch.ts` (`ingestInvoice`) — record-then-emit, idempotent on `order_id`, terminal states frozen. Action dispatch (`retryInvoice`/`printInvoice`/`stornoInvoice`/`cancelInvoice`) lives in `src/lib/action-runner.ts` with state guards and an injectable provider override for tests.

Provider credentials are encrypted at rest with AES-256-GCM using `src/lib/crypto.ts` (env `INVOICING_ENCRYPTION_KEY`).

## 11. Secret encryption

`src/lib/crypto.ts` provides AES-256-GCM with scrypt v2 key derivation (plus a legacy v1 SHA-256 format), `isEncrypted`, and `decryptIfNeeded`. The encryption key is read from `INVOICING_ENCRYPTION_KEY` (env or `import.meta.env`); without it, `encrypt`/`decrypt` throw.

---

## 12. Test harness & testing tiers

- **Real-SQLite harness** (`tests/db/harness.ts`, pattern from `../ecomm_plugin/`): an in-memory libSQL DB creating the tables from `schema.ts`, so accessors behave identically in tests and prod. **Every data-access function gets at least a smoke test** (query executes on populated and empty data, returns expected shape); critical flows get deep row-level tests.
- **Tiered testing:** unit (pure logic) → data (harness accessors) → API handler (runMethod with `makeFakeSdk`/`poisonDb`) → e2e (Playwright; arrives with UI features).
- **Test command:** `node --test tests/full-suite.test.ts` — the canonical runner that spawns `node --test <every test file>` as a child. When adding a test file, add its path to `TEST_FILES`.
- **Bracket-path rule:** dynamic-route test files use **bare param names** (`id.test.ts`, NOT `[id].test.ts`) because `node --test` treats `[`/`]` as a glob char class and silently skips them.
- **Current tests** (landed): structural + behavior suites across `tests/` (db harness, lib/data, crypto, providers, draft, ingest, actions, api handlers, pages) — see `tests/full-suite.test.ts` `TEST_FILES`.

---

## 13. Package dependencies

```json
{
  "peerDependencies": { "astro": "^7.0.0" },
  "dependencies": { "@libsql/client": "^0.17.4", "drizzle-orm": "^0.45.2", "zod": "^3.25.76" }
}
```

Versions **track `../notifications_plugin/`** — copy versions verbatim from the siblings when adding a dependency; do not drift versions independently. Node strips TypeScript types natively — no build step needed for tests.

---

## 14. File structure

```
invoicing_plugin/
├── pelerin.manifest.json       # Plugin contract (pages, endpoints, nav, init wired)
├── package.json                # peer dep astro + @libsql/client, drizzle-orm, zod
├── AGENTS.md                   # This file
├── README.md                   # Identity + CMS install + env var
├── src/
│   ├── db/
│   │   ├── schema.ts           # invoices + invoicing_settings (dateType)
│   │   └── seed.ts             # no-op (invoices/settings are created at runtime)
│   ├── lib/
│   │   ├── data/               # invoices.ts, settings.ts, providers.ts accessors
│   │   ├── dispatch.ts         # ingestInvoice (idempotent, durable)
│   │   ├── action-runner.ts    # retry/print/storno/cancel with state guards
│   │   ├── crypto.ts           # AES-256-GCM (INVOICING_ENCRYPTION_KEY)
│   │   ├── order-payload.ts    # OrderInvoicePayload + parseSnapshot
│   │   └── handler-types.ts    # HandlerDeps + toDb
│   ├── init.ts                 # event subscriber (shop.order.invoice → ingest)
│   ├── providers/
│   │   └── invoicing/          # interface.ts, registry.ts, draft.ts, fgo.ts, index.ts
│   ├── api/invoicing/          # invoices list/detail + actions + providers handlers
│   ├── components/             # Breadcrumbs.astro, Pagination.astro
│   │   └── admin/              # TextField, SelectField, CheckboxField, TextareaField
│   └── pages/admin/            # index, invoices/[id], settings/providers{,/[name]}
└── tests/                      # harness, stubs, api helpers + per-feature suites
    └── full-suite.test.ts      # canonical runner (TEST_FILES)
```

---

## 15. Development workflow

Before committing, run all quality checks against the code you changed:

| Check      | Command                 | Scope                                      | Must pass?    |
| ---------- | ----------------------- | ------------------------------------------ | ------------- |
| Format     | `npm run format:check`  | All files (excluding ignores)              | Yes — exit 0  |
| Lint       | `npm run lint`          | `src/` + root configs (excludes `tests/`)  | Yes — exit 0  |
| Type-check | `npm run type-check`    | `src/**/*.ts` only (excludes tests, astro) | Yes — exit 0  |
| Tests      | `npm run test`          | Full suite via `tests/full-suite.test.ts`  | Yes — exit 0  |
| Coverage   | `npm run test:coverage` | Same as tests, with coverage report        | Informational |

Steps:

1. **Read** this file and `reespec/decisions.md` before modifying code.
2. **Run checks relevant to your change** — if you touched `src/`, run all four; if only tests, run format + test.
3. **Run the full suite:** `npm run test`.
4. When adding a `.test.ts` file, add its path to `TEST_FILES` in `tests/full-suite.test.ts`, using **bare param names** (no `[`/`]`).

> Follow the house conventions documented here — endpoint convention, database injection, SDK-only surface, and testability — so work stays consistent across the Pelerin plugin ecosystem.
