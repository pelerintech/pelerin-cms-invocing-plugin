import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

/** Our local copies */
const local = {
  'src/components/Breadcrumbs.astro': 'notifications',
  'src/components/Pagination.astro': 'notifications',
  'src/components/admin/TextField.astro': 'ecomm',
  'src/components/admin/SelectField.astro': 'ecomm',
  'src/components/admin/CheckboxField.astro': 'ecomm',
  'src/components/admin/TextareaField.astro': 'ecomm',
};

/** Sibling originals (relative to this repo root) */
const siblings = {
  notifications: '../notifications_plugin',
  ecomm: '../ecomm_plugin',
};

function siblingPath(kind: string, filename: string): string {
  const base = resolve(root, siblings[kind]);
  return (
    base +
    (kind === 'notifications' ? `/src/components/${filename}` : `/src/components/admin/${filename}`)
  );
}

test('all six standard admin components exist as local copies', () => {
  for (const file of Object.keys(local)) {
    // readFileSync throws if missing — asserting actual file presence
    readFileSync(resolve(root, file), 'utf-8');
  }
});

test('each local component is byte-identical to its sibling original', () => {
  for (const [localFile, kind] of Object.entries(local)) {
    const localPath = resolve(root, localFile);
    const origPath = siblingPath(kind, localFile.split('/').pop()!);
    const localContent = readFileSync(localPath, 'utf-8');
    const origContent = readFileSync(origPath, 'utf-8');
    assert.strictEqual(
      localContent,
      origContent,
      `expected ${localFile} to be byte-identical to its sibling original`
    );
  }
});
