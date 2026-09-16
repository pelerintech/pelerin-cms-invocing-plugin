import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAGE_PATH = join(__dirname, '../../src/pages/admin/invoices/[id].astro');
const ESBUILD = join(__dirname, '../../node_modules/esbuild/bin/esbuild');

describe('admin invoices/[id].astro (invoice detail) — structure + client <script> syntax', () => {
  it('renders invoice + order-from-snapshot blocks with action buttons', () => {
    const src = readFileSync(PAGE_PATH, 'utf-8');
    assert.match(src, /AdminLayout/, 'page must import AdminLayout');
    assert.match(src, /createPluginContext/, 'page must import createPluginContext');
    assert.match(src, /requireAdmin/, 'page must call sdk.auth.requireAdmin');
    assert.match(src, /getInvoiceById/, 'page must use the getInvoiceById accessor');
    assert.match(src, /snapshot/, 'page must render from the saved order snapshot');
    // action buttons that fetch the matching endpoint (via runAction(action))
    assert.match(src, /emit/, 'must wire the emit endpoint');
    assert.match(src, /print/, 'must wire the print endpoint');
    assert.match(src, /storno/, 'must wire the storno endpoint');
    assert.match(src, /cancel/, 'must wire the cancel endpoint');
    // captures the provider request/response in an "Extra info" accordion
    assert.match(src, /Extra info/, 'must render an "Extra info" accordion');
    assert.match(src, /req_payload/, 'must render req_payload');
    assert.match(src, /res_payload/, 'must render res_payload');
  });

  it('client <script> parses without a syntax error', () => {
    const src = readFileSync(PAGE_PATH, 'utf-8');
    const matches = [...src.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
    assert.ok(matches.length > 0, 'expected at least one <script> block');
    const clientScript = matches[matches.length - 1][1];

    const tmpDir = mkdtempSync(join(tmpdir(), 'astro-script-check-'));
    const tmpIn = join(tmpDir, 'client.ts');
    writeFileSync(tmpIn, clientScript, 'utf-8');
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
