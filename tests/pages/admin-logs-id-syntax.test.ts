import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAGE_PATH = join(__dirname, '../../src/pages/admin/logs/[id].astro');
const ESBUILD = join(__dirname, '../../node_modules/esbuild/bin/esbuild');

describe('admin logs/[id].astro (logs detail) — structure + client <script> syntax', () => {
  it('page exists and wraps in AdminLayout using the plugin SDK', () => {
    const src = readFileSync(PAGE_PATH, 'utf-8');
    assert.match(src, /AdminLayout/, 'page must import AdminLayout');
    assert.match(src, /createPluginContext/, 'page must import createPluginContext');
    assert.match(src, /requireAdmin/, 'page must call sdk.auth.requireAdmin');
    assert.match(src, /getDevLog/, 'page must use the getDevLog accessor');
    assert.match(src, /request_json/i, 'page must render the captured request_json');
    // Outcome picker shown for pending logs
    assert.match(src, /pending/i, 'page must reference the pending resolution');
    assert.match(src, /outcome/i, 'page must reference the outcome picker');
  });

  it('client <script> parses without a syntax error', () => {
    const src = readFileSync(PAGE_PATH, 'utf-8');
    const matches = [...src.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
    if (matches.length === 0) return;
    const script = matches[matches.length - 1][1];
    const tmpDir = mkdtempSync(join(tmpdir(), 'astro-script-check-'));
    const tmpIn = join(tmpDir, 'client.ts');
    writeFileSync(tmpIn, script, 'utf-8');
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
