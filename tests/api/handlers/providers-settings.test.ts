import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { ensureLoader } from '../../stubs/register.mjs';
import { makeFakeSdk, makeCtx, unauthorizedError } from '../helpers.ts';
import { createTestDb } from '../../db/harness.ts';
import { setSetting, getSetting } from '../../../src/lib/data/settings.ts';
import { encrypt, decryptIfNeeded, isEncrypted } from '../../../src/lib/crypto.ts';

const KEY = 'test-encryption-key-32+chars-long';
const originalKey = process.env.INVOICING_ENCRYPTION_KEY;
before(() => {
  process.env.INVOICING_ENCRYPTION_KEY = KEY;
});
after(() => {
  if (originalKey === undefined) delete process.env.INVOICING_ENCRYPTION_KEY;
  else process.env.INVOICING_ENCRYPTION_KEY = originalKey;
});

ensureLoader();
const providersIndex = await import('../../../src/api/invoicing/providers/index.ts');
const settings = await import('../../../src/api/invoicing/providers/[name]/settings.ts');

async function raw(db: any, key: string): Promise<string | null> {
  return getSetting(db, key);
}

describe('GET /providers (providers list)', () => {
  let db: any;
  beforeEach(async () => {
    const t = await createTestDb();
    db = t.db;
  });

  test('returns registered providers with configured status', async () => {
    await setSetting(db, 'fgo_cui', encrypt('RO123'));
    await setSetting(db, 'fgo_private_key', encrypt('k'));
    await setSetting(db, 'fgo_serie', encrypt('FGO'));
    await setSetting(db, 'fgo_tip_factura', encrypt('FACTURA'));
    await setSetting(db, 'fgo_api_url', encrypt('https://api.fgo.ro/v1'));
    await setSetting(db, 'fgo_platform_redirect_url', encrypt('https://yourapp.com'));

    const res = await providersIndex.runGet({
      db,
      sdk: makeFakeSdk(),
      ctx: makeCtx({ url: 'http://localhost/api/plugins/invoicing/providers' }),
    });
    assert.equal(res.status, 200);
    const b = await res.json();
    assert.equal(b.success, true);
    const fgo = b.data.providers.find((p: any) => p.name === 'fgo');
    assert.ok(fgo, 'fgo must be listed');
    assert.equal(fgo.configured, true);
  });

  test('reports a provider as not configured when settings missing', async () => {
    const res = await providersIndex.runGet({
      db,
      sdk: makeFakeSdk(),
      ctx: makeCtx({ url: 'http://localhost/api/plugins/invoicing/providers' }),
    });
    const b = await res.json();
    const fgo = b.data.providers.find((p: any) => p.name === 'fgo');
    assert.equal(fgo.configured, false);
  });

  test('auth-fail → 401', async () => {
    const sdk = makeFakeSdk({ authThrows: unauthorizedError() });
    const ctx = makeCtx({ url: 'http://localhost/api/plugins/invoicing/providers' });
    const res = await providersIndex.runGet({ db, sdk, ctx });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).success, false);
  });
});

describe('GET /providers/[name]/settings', () => {
  let db: any;
  beforeEach(async () => {
    const t = await createTestDb();
    db = t.db;
  });

  test('returns masked values; password fields masked to ****<last4>', async () => {
    await setSetting(db, 'fgo_private_key', encrypt('super-secret-key-9'));
    await setSetting(db, 'fgo_cui', encrypt('RO12345678'));
    const res = await settings.runGet({
      db,
      sdk: makeFakeSdk(),
      ctx: makeCtx({ url: 'http://localhost/api', params: { name: 'fgo' } }),
    });
    assert.equal(res.status, 200);
    const b = await res.json();
    assert.equal(b.success, true);
    assert.equal(b.data.fgo_private_key, '****ey-9');
    assert.equal(b.data.fgo_cui, 'RO12345678');
  });

  test('unknown provider → 404', async () => {
    const res = await settings.runGet({
      db,
      sdk: makeFakeSdk(),
      ctx: makeCtx({ url: 'http://localhost/api', params: { name: 'nonexistent' } }),
    });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).success, false);
  });

  test('no rows → empty data object', async () => {
    const res = await settings.runGet({
      db,
      sdk: makeFakeSdk(),
      ctx: makeCtx({ url: 'http://localhost/api', params: { name: 'fgo' } }),
    });
    const b = await res.json();
    assert.deepEqual(b.data, {});
  });
});

describe('POST /providers/[name]/settings', () => {
  let db: any;
  beforeEach(async () => {
    const t = await createTestDb();
    db = t.db;
  });

  test('saves settings encrypted, returns masked result', async () => {
    const res = await settings.runPost({
      db,
      sdk: makeFakeSdk(),
      ctx: makeCtx({
        url: 'http://localhost/api',
        body: { fgo_private_key: 'secret-1', fgo_cui: 'RO123' },
        params: { name: 'fgo' },
      }),
    });
    assert.equal(res.status, 200);
    const b = await res.json();
    assert.equal(b.success, true);
    assert.equal(b.data.saved.fgo_private_key, true);

    const stored = await raw(db, 'fgo_private_key');
    assert.ok(isEncrypted(stored!), 'stored value must be encrypted');
    assert.equal(decryptIfNeeded(stored!), 'secret-1');
  });

  test('empty password preserves existing value (not overwritten)', async () => {
    await setSetting(db, 'fgo_private_key', encrypt('existing'));
    const res = await settings.runPost({
      db,
      sdk: makeFakeSdk(),
      ctx: makeCtx({
        url: 'http://localhost/api',
        body: { fgo_private_key: '' },
        params: { name: 'fgo' },
      }),
    });
    assert.equal(res.status, 200);
    const stored = await raw(db, 'fgo_private_key');
    assert.equal(decryptIfNeeded(stored!), 'existing');
  });

  test('unchanged masked value is skipped', async () => {
    await setSetting(db, 'fgo_private_key', encrypt('SG.real-key'));
    const res = await settings.runPost({
      db,
      sdk: makeFakeSdk(),
      ctx: makeCtx({
        url: 'http://localhost/api',
        body: { fgo_private_key: '****-key' },
        params: { name: 'fgo' },
      }),
    });
    assert.equal(res.status, 200);
    const stored = await raw(db, 'fgo_private_key');
    assert.equal(decryptIfNeeded(stored!), 'SG.real-key');
  });

  test('unknown provider → 404', async () => {
    const res = await settings.runPost({
      db,
      sdk: makeFakeSdk(),
      ctx: makeCtx({
        url: 'http://localhost/api',
        body: { fgo_cui: 'x' },
        params: { name: 'nonexistent' },
      }),
    });
    assert.equal(res.status, 404);
  });

  test('unknown keys silently skipped', async () => {
    const res = await settings.runPost({
      db,
      sdk: makeFakeSdk(),
      ctx: makeCtx({
        url: 'http://localhost/api',
        body: { not_a_real_key: 'x', fgo_cui: 'RO1' },
        params: { name: 'fgo' },
      }),
    });
    assert.equal(res.status, 200);
    assert.equal(await raw(db, 'not_a_real_key'), null);
    assert.equal(decryptIfNeeded((await raw(db, 'fgo_cui'))!), 'RO1');
  });

  test('auth-fail → 401', async () => {
    const sdk = makeFakeSdk({ authThrows: unauthorizedError() });
    const ctx = makeCtx({
      url: 'http://localhost/api',
      body: { fgo_cui: 'x' },
      params: { name: 'fgo' },
    });
    const res = await settings.runPost({ db, sdk, ctx });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).success, false);
  });
});
