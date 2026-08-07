import { test } from 'node:test';
import assert from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

const srcDir = resolve(import.meta.dirname, '../src');
const schemaPath = resolve(srcDir, 'db/schema.ts');
const seedPath = resolve(srcDir, 'db/seed.ts');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

test('schema module imports cleanly outside Astro', async () => {
  const schema = await import(schemaPath);
  assert.ok(schema, 'schema.ts must import without error');
});

test('schema exports the dateType custom column helper', async () => {
  const schema = await import(schemaPath);
  assert.ok(schema.dateType, 'schema.ts must export dateType');
});

test('no astro:db import appears in src/** except src/db/seed.ts', () => {
  const files = walk(srcDir).filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));
  assert.ok(files.length > 0, 'there should be .ts files under src to check');
  const offenders: string[] = [];
  for (const file of files) {
    if (file === seedPath) continue;
    const content = readFileSync(file, 'utf-8');
    if (content.includes('astro:db')) {
      offenders.push(relative(srcDir, file));
    }
  }
  assert.deepStrictEqual(offenders, []);
});

test('seed module exports a default function', async () => {
  const seed = await import(seedPath);
  assert.strictEqual(typeof seed.default, 'function');
});
