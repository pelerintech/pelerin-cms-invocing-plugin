import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const agentsPath = resolve(import.meta.dirname, '../AGENTS.md');
const content = readFileSync(agentsPath, 'utf-8');

// Mandatory section/convention markers from the coding-conventions spec.
const mandatoryMarkers = [
  'What this project is',
  'Plugin manifest',
  'Data access layer',
  'mandatory pattern',
  'db injection',
  'Endpoint handler pattern',
  'requireAdmin',
  '{ success',
  'pelerin:plugin-sdk',
  'test harness',
  'File structure',
  'Development workflow',
  'inArray',
];

test('AGENTS.md exists', () => {
  assert.ok(content.length > 0, 'AGENTS.md should be non-empty');
});

test('AGENTS.md contains all mandatory convention markers', () => {
  const missing = mandatoryMarkers.filter((m) => !content.includes(m));
  assert.deepStrictEqual(missing, [], `missing markers: ${missing.join(', ')}`);
});

test('AGENTS.md identifies the plugin as a generic invoicing plugin with providers', () => {
  assert.ok(
    content.includes('pelerin_invoicing') || content.includes('invoicing plugin'),
    'AGENTS.md must identify the invoicing plugin'
  );
});
