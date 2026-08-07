import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createTestDb } from '../../db/harness.ts';
import { getSetting, setSetting, listSettingsForProvider } from '../../../src/lib/data/settings.ts';
import { invoicing_settings } from '../../../src/db/schema.ts';

let db: any;

describe('settings accessors (get/set/list by provider)', () => {
  beforeEach(async () => {
    const t = await createTestDb();
    db = t.db;
  });

  test('setSetting then getSetting returns the stored value', async () => {
    await setSetting(db, 'fgo_cui', 'RO12345678');
    assert.equal(await getSetting(db, 'fgo_cui'), 'RO12345678');
  });

  test('getSetting returns null for a missing key', async () => {
    assert.equal(await getSetting(db, 'fgo_missing'), null);
  });

  test('setSetting overwrites an existing key without duplicating the row', async () => {
    await setSetting(db, 'fgo_cui', 'first');
    await setSetting(db, 'fgo_cui', 'second');
    assert.equal(await getSetting(db, 'fgo_cui'), 'second');

    const rows = await db.select().from(invoicing_settings);
    assert.equal(rows.length, 1, 'overwrite must reuse the same row, not duplicate');
  });

  test('listSettingsForProvider returns fgo_-prefixed keys with prefix stripped', async () => {
    await setSetting(db, 'fgo_cui', 'RO123');
    await setSetting(db, 'fgo_private_key', 'abc');
    await setSetting(db, 'unrelated_key', 'nope');

    const result = await listSettingsForProvider(db, 'fgo');
    assert.deepEqual(result, { cui: 'RO123', private_key: 'abc' });
  });

  test('listSettingsForProvider is empty when no matching keys exist', async () => {
    const result = await listSettingsForProvider(db, 'fgo');
    assert.deepEqual(result, {});
  });

  test('listSettingsForProvider does not match a key with a single-char wildcard collision', async () => {
    // `fgoXcui` (no underscore) must NOT match the `fgo_` prefix filter.
    await setSetting(db, 'fgo_cui', 'RO1');
    await setSetting(db, 'fgoXcui', 'TRAVESTY');
    const result = await listSettingsForProvider(db, 'fgo');
    assert.deepEqual(result, { cui: 'RO1' });
  });
});
