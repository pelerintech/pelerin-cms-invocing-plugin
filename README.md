# Pelerin Invoicing

Invoicing plugin for [Pelerin CMS](https://github.com/pelerintech/pelerin-cms). A generic invoicing plugin: it consumes order lifecycle events from the ecommerce plugin and emits invoices in an external invoicing system behind a pluggable provider interface. The first provider is [FGO](https://api.fgo.ro/v1); the abstraction is intended to support other Romanian providers (SmartBill, Oblio) later.

It subscribes to the `shop.order.invoice` event from the ecommerce plugin, persists one durable/idempotent invoice per order, emits canonical drafts to the configured provider, and exposes an admin UI + API to list invoices, run actions (emit/print/storno/cancel), and configure provider credentials.

> **Status: functional core landed.** The scaffold "no features yet" status is superseded — the invoices + settings tables, event wiring, FGO provider, admin pages, and API endpoints are implemented (see `AGENTS.md`).

## Configuration

Set the encryption key used to encrypt provider credentials at rest:

```bash
export INVOICING_ENCRYPTION_KEY=some-long-random-secret
```

`INVOICING_ENCRYPTION_KEY` is **required** before you can save provider credentials — the settings form calls `encrypt()` on each value, which throws without it. Use a long, random secret (e.g. 48+ bytes of hex entropy).

> **Keep it stable.** The key is the input to the KDF that derives the AES key. If you change or rotate it, provider credentials already encrypted in `invoicing_settings` become **undecryptable** and the provider will appear **unconfigured**. Set it once before entering credentials and never rotate it unless you also re-encrypt the stored values.

## Installation

This plugin is installed into a running Pelerin CMS instance. The CMS resolves plugins at `pelerin_cms/plugins/<name>` (see `../pelerin_cms/`).

For local development, symlink the repo into the CMS plugins directory:

```bash
ln -s /path/to/this/repo /path/to/pelerin_cms/plugins/invoicing_plugin
```

Then register it in the CMS's `pelerin.config.mjs` (this file is gitignored in the CMS):

```js
export default {
  plugins: [{ name: 'invoicing_plugin', source: 'local' }],
};
```

Run `npm run plugins:install` (or `plugins:sync`) from the CMS root and restart the dev server.

## Public API

A logged-in consumer can check whether an invoice has been issued for one of their orders and, when it has, get its PDF download URL. This is the plugin's first public (non-admin) endpoint — it is authorised via `sdk.auth.getUser` (the consumer's session), not admin auth.

```text
GET /api/plugins/invoicing/public/invoices/download?user_id=<id>&order_id=<id>
```

Ownership is enforced in two independent steps: the session user must equal the `user_id` param, and the stored invoice's `user_id` (carried on the order-invoice payload from the ecomm plugin) must equal the session user. Responses:

- `200` issued → `{ success, data: { issued: true, series, number, pdfUrl, status } }`
- `200` not yet/not issued → `{ success, data: { issued: false, status } }` (pending / failed / storned / cancelled — no `pdfUrl`)
- `401` no session · `403` not the owner · `404` no invoice for the order · `422` missing `user_id`/`order_id`

Only an `issued` invoice yields a `pdfUrl`; the endpoint returns the stored link (no PDF is stored or proxied by this plugin).

## Available scripts

| Script                  | Purpose                                                          |
| ----------------------- | ---------------------------------------------------------------- |
| `npm run format`        | Format all files (prettier)                                      |
| `npm run format:check`  | Check formatting                                                 |
| `npm run lint`          | Lint `src/` + root configs (eslint)                              |
| `npm run type-check`    | Type-check `src/**/*.ts` (tsc --noEmit)                          |
| `npm run test`          | Run the full test suite (`node --test tests/full-suite.test.ts`) |
| `npm run test:coverage` | Run the suite with coverage report                               |

## Contributing / Local development

Before modifying code, read `AGENTS.md` — it documents the mandatory patterns (data access layer with injected `db`, endpoint handler pattern, SDK-only surface, test harness) so work stays consistent across the Pelerin plugin ecosystem.
