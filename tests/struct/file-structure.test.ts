import { test } from 'node:test';
import assert from 'node:assert';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

const expectedDirs = [
  'src/api/invoicing',
  'src/pages/admin',
  'src/components',
  'src/components/admin',
  'src/lib',
  'src/lib/data',
  'src/providers/invoicing',
  'src/schemas',
];

const expectedFiles = ['pelerin.manifest.json', 'src/db/schema.ts', 'src/db/seed.ts'];

test('skeleton directories exist (managed as .gitkeep placeholders)', () => {
  for (const dir of expectedDirs) {
    const full = resolve(root, dir);
    assert.ok(existsSync(full), `expected directory missing: ${dir}`);
  }
});

test('each skeleton directory contains a .gitkeep marker', () => {
  for (const dir of expectedDirs) {
    const entries = readdirSync(resolve(root, dir));
    assert.ok(entries.includes('.gitkeep'), `expected ${dir} to contain .gitkeep for git tracking`);
  }
});

test('scaffold source files from tasks 3-4 exist', () => {
  for (const file of expectedFiles) {
    assert.ok(existsSync(resolve(root, file)), `expected file missing: ${file}`);
  }
});
