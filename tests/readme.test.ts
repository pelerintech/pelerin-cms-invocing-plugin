import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readmePath = resolve(import.meta.dirname, '../README.md');
const content = readFileSync(readmePath, 'utf-8');

const requiredSnippets = [
  'pelerin_invoicing',
  '## Installation',
  '## Available scripts',
  "{ name: 'pelerin_invoicing', source: 'local' }",
];

test('README.md exists', () => {
  assert.ok(content.length > 0, 'README.md should be non-empty');
});

test('README.md contains required identity/installation snippets', () => {
  const missing = requiredSnippets.filter((s) => !content.includes(s));
  assert.deepStrictEqual(missing, [], `missing snippets: ${missing.join(', ')}`);
});

test('README.md states the scaffold-only status', () => {
  assert.ok(
    /scaffold|no features yet|no features/i.test(content),
    'README must state scaffold-only status'
  );
});

test('README.md documents the CMS registration (symlink capture)', () => {
  assert.ok(
    content.includes('plugins/pelerin_invoicing'),
    'README must reference the CMS plugin directory'
  );
});
