import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Verifies pelerin.manifest.json satisfies the CMS validateManifest contract.
 * Replicates the required-field checks in pelerin_cms/src/lib/plugins/manifest.ts.
 */
const manifestPath = resolve(import.meta.dirname, '../pelerin.manifest.json');

test('manifest exists and is valid JSON', () => {
  const raw = readFileSync(manifestPath, 'utf-8');
  const parsed = JSON.parse(raw);
  assert.ok(parsed, 'manifest must parse as a JSON object');
});

test('manifest carries the plugin identity', () => {
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  assert.strictEqual(parsed.name, 'invoicing_plugin');
  assert.strictEqual(parsed.displayName, 'Invoicing');
  assert.strictEqual(parsed.version, '1.0.0');
});

test('manifest satisfies the validateManifest required-field contract', () => {
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  assert.strictEqual(typeof parsed.name, 'string');
  assert.strictEqual(typeof parsed.version, 'string');
  assert.strictEqual(typeof parsed.displayName, 'string');
  assert.strictEqual(typeof parsed.dbConfig, 'string');
  for (const key of ['publicPages', 'adminPages', 'apiEndpoints', 'navItems']) {
    assert.ok(Array.isArray(parsed[key]), `${key} must be an array`);
  }
});

test('dbConfig and dbSeed point at the scaffold files', () => {
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  assert.strictEqual(parsed.dbConfig, './src/db/schema.ts');
  assert.strictEqual(parsed.dbSeed, './src/db/seed.ts');
});

test('page/endpoint/nav arrays are empty (no feature wiring yet)', () => {
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  // Scaffold assertion superseded — the invoicing-core request wires these.
  assert.ok(Array.isArray(parsed.publicPages));
  assert.deepStrictEqual(parsed.publicPages, []);
});

// ─── Feature wiring (invoicing-core) ───────────────────────────────────────

test('adminPages contains the four invoicing pages', () => {
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const patterns = parsed.adminPages.map((p: any) => p.pattern);
  for (const p of [
    '/admin/plugins/invoicing',
    '/admin/plugins/invoicing/invoices/[id]',
    '/admin/plugins/invoicing/settings/providers',
    '/admin/plugins/invoicing/settings/providers/[name]',
  ]) {
    assert.ok(patterns.includes(p), `adminPages must include ${p}`);
  }
});

test('apiEndpoints contains the full endpoint set', () => {
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const patterns = parsed.apiEndpoints.map((p: any) => p.pattern);
  for (const p of [
    '/api/plugins/invoicing/invoices',
    '/api/plugins/invoicing/invoices/[id]',
    '/api/plugins/invoicing/invoices/[id]/emit',
    '/api/plugins/invoicing/invoices/[id]/print',
    '/api/plugins/invoicing/invoices/[id]/storno',
    '/api/plugins/invoicing/invoices/[id]/cancel',
    '/api/plugins/invoicing/providers',
    '/api/plugins/invoicing/providers/[name]/settings',
    '/api/plugins/invoicing/public/invoices/download',
  ]) {
    assert.ok(patterns.includes(p), `apiEndpoints must include ${p}`);
  }
});

test('navItems has Invoices and Providers under the invoicing namespace', () => {
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const labels = parsed.navItems.map((n: any) => n.label);
  assert.ok(labels.includes('Invoices'), 'navItems must include an Invoices entry');
  assert.ok(labels.includes('Providers'), 'navItems must include a Providers entry');
  const hrefs = parsed.navItems.map((n: any) => n.href);
  assert.ok(
    hrefs.every((h: string) => h.startsWith('/admin/plugins/invoicing')),
    'nav hrefs must stay in the invoicing namespace'
  );
});

// ─── Dev-mode logs surface (invoicing-dev-mode) ────────────────────────────

test('adminPages register the logs list + detail pages', () => {
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const patterns = parsed.adminPages.map((p: any) => p.pattern);
  assert.ok(patterns.includes('/admin/plugins/invoicing/logs'), 'must register logs list page');
  assert.ok(
    patterns.includes('/admin/plugins/invoicing/logs/[id]'),
    'must register logs detail page'
  );
});

test('apiEndpoints register the three logs endpoints', () => {
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const patterns = parsed.apiEndpoints.map((p: any) => p.pattern);
  assert.ok(patterns.includes('/api/plugins/invoicing/logs'), 'must register logs list');
  assert.ok(patterns.includes('/api/plugins/invoicing/logs/[id]'), 'must register logs detail');
  assert.ok(
    patterns.includes('/api/plugins/invoicing/logs/[id]/outcome'),
    'must register logs outcome'
  );
});

test('navItems includes a Logs entry under the invoicing namespace', () => {
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const labels = parsed.navItems.map((n: any) => n.label);
  assert.ok(labels.includes('Logs'), 'navItems must include a Logs entry');
  const logs = parsed.navItems.find((n: any) => n.label === 'Logs');
  assert.ok(logs.href.startsWith('/admin/plugins/invoicing'), 'Logs nav must be in the namespace');
});

test('identity fields unchanged', () => {
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  assert.strictEqual(parsed.name, 'invoicing_plugin');
  assert.strictEqual(parsed.displayName, 'Invoicing');
  assert.strictEqual(parsed.version, '1.0.0');
  assert.strictEqual(parsed.dbConfig, './src/db/schema.ts');
});

test('entrypoints in adminPages/apiEndpoints point at existing files', () => {
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  for (const page of parsed.adminPages) {
    assert.ok(
      existsSync(resolve(import.meta.dirname, '..', page.entrypoint)),
      `missing admin entrypoint ${page.entrypoint}`
    );
  }
  for (const api of parsed.apiEndpoints) {
    assert.ok(
      existsSync(resolve(import.meta.dirname, '..', api.entrypoint)),
      `missing api entrypoint ${api.entrypoint}`
    );
  }
});

test('init hook points at the event subscriber', () => {
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  assert.strictEqual(parsed.init, './src/init.ts');
  assert.strictEqual(parsed.subscribeEvents, undefined);
});
