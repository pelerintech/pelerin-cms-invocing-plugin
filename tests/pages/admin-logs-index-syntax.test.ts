import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAGE_PATH = join(__dirname, '../../src/pages/admin/logs/index.astro');
const ESBUILD = join(__dirname, '../../node_modules/esbuild/bin/esbuild');

describe('admin logs/index.astro (logs list) — structure + client <script> syntax', () => {
  it('page exists and wraps in AdminLayout using the plugin SDK', () => {
    const src = readFileSync(PAGE_PATH, 'utf-8');
    assert.match(src, /AdminLayout/, 'page must import AdminLayout');
    assert.match(src, /createPluginContext/, 'page must import createPluginContext');
    assert.match(src, /requireAdmin/, 'page must call sdk.auth.requireAdmin');
    assert.match(src, /listDevLogs/, 'page must use the listDevLogs accessor');
    assert.match(src, /logs/i, 'page must reference the logs surface');
    // Dev-mode banner (capture surface)
    assert.match(src, /dev/i, 'page must show a dev-mode banner');
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
