import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAGE_PATH = join(__dirname, '../../src/pages/admin/index.astro');
const ESBUILD = join(__dirname, '../../node_modules/esbuild/bin/esbuild');

function clientScripts(source: string): string[] {
  const matches = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
  return matches.map((m) => m[1]);
}

describe('admin index.astro (invoices list) — structure + client <script> syntax', () => {
  it('page exists and wraps in AdminLayout using the plugin SDK', () => {
    const src = readFileSync(PAGE_PATH, 'utf-8');
    assert.match(src, /AdminLayout/, 'page must import AdminLayout');
    assert.match(src, /createPluginContext/, 'page must import createPluginContext');
    assert.match(src, /requireAdmin/, 'page must call sdk.auth.requireAdmin');
    assert.match(src, /listInvoices/, 'page must use the listInvoices accessor');
    assert.match(src, /No invoices found/, 'page must have an empty state');
    assert.match(src, /status/, 'page must render a status column/filter');
  });

  it('any client <script> parses without a syntax error', () => {
    const src = readFileSync(PAGE_PATH, 'utf-8');
    const scripts = clientScripts(src);
    if (scripts.length === 0) return; // server-rendered page with no client script

    const tmpDir = mkdtempSync(join(tmpdir(), 'astro-script-check-'));
    const tmpIn = join(tmpDir, 'client.ts');
    writeFileSync(tmpIn, scripts[scripts.length - 1], 'utf-8');
    let exitCode = 0;
    let combined = '';
    try {
      combined = execFileSync(ESBUILD, [tmpIn], { encoding: 'utf-8' });
    } catch (err: any) {
      exitCode = err.status ?? 1;
      combined = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
    assert.equal(exitCode, 0, `client script has a syntax error:\n${combined}`);
  });
});
