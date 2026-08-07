import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PAGE_PATH = join(__dirname, '../../src/pages/admin/settings/providers/index.astro');
const ESBUILD = join(__dirname, '../../node_modules/esbuild/bin/esbuild');

describe('admin settings/providers/index.astro — structure + script syntax', () => {
  it('renders provider cards with a configured badge', () => {
    const src = readFileSync(PAGE_PATH, 'utf-8');
    assert.match(src, /AdminLayout/, 'must import AdminLayout');
    assert.match(src, /createPluginContext/, 'must import createPluginContext');
    assert.match(src, /requireAdmin/, 'must call requireAdmin');
    assert.match(src, /isProviderConfigured/, 'must use isProviderConfigured');
    assert.match(src, /configured/i, 'must show configured/not-configured status');
    assert.match(src, /listProviderObjects/, 'must list registered providers dynamically');
  });

  it('any client <script> parses without a syntax error', () => {
    const src = readFileSync(PAGE_PATH, 'utf-8');
    const matches = [...src.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
    if (matches.length === 0) return;
    const tmpDir = mkdtempSync(join(tmpdir(), 'astro-script-check-'));
    const tmpIn = join(tmpDir, 'client.ts');
    writeFileSync(tmpIn, matches[matches.length - 1][1], 'utf-8');
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
