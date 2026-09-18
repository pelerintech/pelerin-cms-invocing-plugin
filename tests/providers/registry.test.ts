import { describe, test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  registerProvider,
  getProvider,
  listProviders,
} from '../../src/providers/invoicing/registry.ts';
import { isProviderConfigured } from '../../src/lib/data/providers.ts';
import { setSetting } from '../../src/lib/data/settings.ts';
import { encrypt } from '../../src/lib/crypto.ts';
import { createTestDb } from '../db/harness.ts';
import type { InvoicingProvider } from '../../src/providers/invoicing/interface.ts';

// Register a realistic 'fgo' provider ONCE at module load (the registry is a
// module-level Map shared across tests in this file; duplicate register throws).
registerProvider(
  makeProvider('fgo', [
    'fgo_cui',
    'fgo_private_key',
    'fgo_serie',
    'fgo_tip_factura',
    'fgo_api_url',
    'fgo_platform_redirect_url',
  ])
);

const KEY = 'test-encryption-key-32+chars-long';
const originalKey = process.env.INVOICING_ENCRYPTION_KEY;

before(() => {
  process.env.INVOICING_ENCRYPTION_KEY = KEY;
});
after(() => {
  if (originalKey === undefined) delete process.env.INVOICING_ENCRYPTION_KEY;
  else process.env.INVOICING_ENCRYPTION_KEY = originalKey;
});

/** Full-featured fake provider mimicking the FGO config schema. */
function makeProvider(name: string, requiredKeys: string[], fields?: any): InvoicingProvider {
  return {
    name,
    getConfigSchema: () => ({ requiredKeys, fields }),
    create: async () => ({ success: true, series: 'A', number: '1' }),
    print: async () => ({ success: true }),
    cancel: async () => ({ success: true }),
    storno: async () => ({ success: true }),
  };
}

describe('registry basics', () => {
  test('registerProvider/getProvider/listProviders round-trip', () => {
    registerProvider(makeProvider('fgo-type', ['fgo_cui']));
    const p = getProvider('fgo-type');
    assert.ok(p);
    assert.equal(p.name, 'fgo-type');
    assert.ok(listProviders().includes('fgo-type'));
  });

  test('getProvider returns null for unknown', () => {
    assert.equal(getProvider('does-not-exist'), null);
  });

  test('duplicate registration throws', () => {
    registerProvider(makeProvider('dup', []));
    assert.throws(() => registerProvider(makeProvider('dup', [])), /already registered/i);
  });

  test('getConfigSchema returns requiredKeys + fields shape', () => {
    const p = makeProvider('cfg', ['a', 'b'], {
      a: { type: 'text', label: 'A', description: 'desc' },
    });
    const schema = p.getConfigSchema();
    assert.deepEqual(schema.requiredKeys, ['a', 'b']);
    assert.equal(schema.fields!.a.type, 'text');
  });
});

describe('isProviderConfigured', () => {
  let db: any;
  beforeEach(async () => {
    const t = await createTestDb();
    db = t.db;
  });

  test('all required keys present and non-empty → true', async () => {
    await setSetting(db, 'fgo_cui', encrypt('RO123'));
    await setSetting(db, 'fgo_private_key', encrypt('key'));
    await setSetting(db, 'fgo_serie', encrypt('FGO'));
    await setSetting(db, 'fgo_tip_factura', encrypt('FACTURA'));
    await setSetting(db, 'fgo_api_url', encrypt('https://api.fgo.ro/v1'));
    await setSetting(db, 'fgo_platform_redirect_url', encrypt('https://yourapp.com'));
    assert.strictEqual(await isProviderConfigured(db, 'fgo'), true);
  });

  test('no settings rows → false', async () => {
    assert.strictEqual(await isProviderConfigured(db, 'fgo'), false);
  });

  test('partial keys → false', async () => {
    await setSetting(db, 'fgo_cui', encrypt('RO123'));
    assert.strictEqual(await isProviderConfigured(db, 'fgo'), false);
  });

  test('empty-string value → false', async () => {
    await setSetting(db, 'fgo_cui', '');
    assert.strictEqual(await isProviderConfigured(db, 'fgo'), false);
  });

  test('whitespace-only value → false', async () => {
    await setSetting(db, 'fgo_cui', encrypt('   '));
    assert.strictEqual(await isProviderConfigured(db, 'fgo'), false);
  });

  test('unknown provider → false', async () => {
    assert.strictEqual(await isProviderConfigured(db, 'nonexistent'), false);
  });
});
