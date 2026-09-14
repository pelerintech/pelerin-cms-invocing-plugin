import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { createTestDb } from '../db/harness.ts';
import { setSetting } from '../../src/lib/data/settings.ts';
import { encrypt } from '../../src/lib/crypto.ts';
import { fgo } from '../../src/providers/invoicing/fgo.ts';

const KEY = 'test-encryption-key-32+chars-long';
const originalKey = process.env.INVOICING_ENCRYPTION_KEY;

before(() => {
  process.env.INVOICING_ENCRYPTION_KEY = KEY;
});
after(() => {
  if (originalKey === undefined) delete process.env.INVOICING_ENCRYPTION_KEY;
  else process.env.INVOICING_ENCRYPTION_KEY = originalKey;
});

const CUI = 'RO12345678';
const PRIVATE_KEY = 'my-private-key';
const URL = 'https://api-testuat.fgo.ro/v1';
const SERIE = 'FGO2026';
const NUMBER = '42';

function configure(db: any) {
  return Promise.all([
    setSetting(db, 'fgo_cui', encrypt(CUI)),
    setSetting(db, 'fgo_private_key', encrypt(PRIVATE_KEY)),
    setSetting(db, 'fgo_serie', encrypt(SERIE)),
    setSetting(db, 'fgo_tip_factura', encrypt('FACTURA')),
    setSetting(db, 'fgo_platforma_url', encrypt(URL)),
  ]);
}

function sha1Hash(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex').toUpperCase();
}

describe('FGO print / cancel / storno (stubbed fetch)', () => {
  let db: any;
  let captured: { url: string; body: any } | null;

  beforeEach(async () => {
    const t = await createTestDb();
    db = t.db;
    captured = null;
    globalThis.fetch = async (url: string, options: any) => {
      captured = { url, body: JSON.parse(options.body) };
      return {
        ok: true,
        json: async () => ({ Success: true, Factura: {} }),
        text: async () => '',
      };
    };
  });
  afterEach(() => {
    delete (globalThis as any).fetch;
  });

  test('print posts /factura/pdf with Hash=SHA1(CUI+key+number) and returns pdfLink', async () => {
    globalThis.fetch = async (url: string, options: any) => {
      captured = { url, body: JSON.parse(options.body) };
      return {
        ok: true,
        json: async () => ({ Success: true, Factura: { Link: 'https://pdf' } }),
        text: async () => '',
      };
    };
    await configure(db);
    const result = await fgo.print(db, SERIE, NUMBER);
    assert.equal(result.success, true);
    assert.equal(result.pdfLink, 'https://pdf');
    assert.equal(captured!.url, `${URL}/factura/pdf`);
    assert.equal(captured!.body.Hash, sha1Hash(`${CUI}${PRIVATE_KEY}${NUMBER}`));
    assert.equal(captured!.body.Serie, SERIE);
    assert.equal(captured!.body.CodUnic, CUI);
    assert.equal(captured!.body.Numar, NUMBER);
    assert.equal(captured!.body.PlatformaUrl, URL);
  });

  test('cancel posts the cancel endpoint and returns success', async () => {
    await configure(db);
    const result = await fgo.cancel(db, SERIE, NUMBER);
    assert.equal(result.success, true);
    assert.equal(captured!.url, `${URL}/factura/anulare`);
    assert.equal(captured!.body.Hash, sha1Hash(`${CUI}${PRIVATE_KEY}${NUMBER}`));
    assert.equal(captured!.body.CodUnic, CUI);
    assert.equal(captured!.body.Numar, NUMBER);
    assert.equal(captured!.body.Serie, SERIE);
  });

  test('storno returns success + storno refs', async () => {
    globalThis.fetch = async (url: string, options: any) => {
      captured = { url, body: JSON.parse(options.body) };
      return {
        ok: true,
        json: async () => ({
          Success: true,
          Factura: { SerieStorno: 'FGO2026', NumarStorno: '43' },
        }),
        text: async () => '',
      };
    };
    await configure(db);
    const result = await fgo.storno(db, SERIE, NUMBER);
    assert.equal(result.success, true);
    assert.equal(result.seriesStorno, 'FGO2026');
    assert.equal(result.numberStorno, '43');
    assert.equal(captured!.body.CodUnic, CUI);
    assert.equal(captured!.body.Numar, NUMBER);
    assert.equal(captured!.body.Serie, SERIE);
  });

  test('provider error → { success:false, error }', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ Success: false, Message: 'Nu exista factura' }),
      text: async () => '',
    });
    await configure(db);
    assert.equal((await fgo.print(db, SERIE, NUMBER)).success, false);
    assert.equal((await fgo.cancel(db, SERIE, NUMBER)).success, false);
    const st = await fgo.storno(db, SERIE, NUMBER);
    assert.equal(st.success, false);
    assert.ok(st.error, 'an error message must be set');
  });

  test('network failure → { success:false, error }', async () => {
    globalThis.fetch = async () => {
      throw new Error('TIMEOUT');
    };
    await configure(db);
    assert.equal((await fgo.print(db, SERIE, NUMBER)).success, false);
  });

  test('actions run with only cui/private_key/url configured (serie/tip unneeded)', async () => {
    // Actions only need the auth trio; the emit-only fgo_serie/fgo_tip_factura
    // keys must not block print/cancel/storno.
    await setSetting(db, 'fgo_cui', encrypt(CUI));
    await setSetting(db, 'fgo_private_key', encrypt(PRIVATE_KEY));
    await setSetting(db, 'fgo_platforma_url', encrypt(URL));

    assert.equal((await fgo.print(db, SERIE, NUMBER)).success, true);
    assert.equal(captured!.url, `${URL}/factura/pdf`);
    assert.equal((await fgo.cancel(db, SERIE, NUMBER)).success, true);
    assert.equal(captured!.url, `${URL}/factura/anulare`);
    assert.equal((await fgo.storno(db, SERIE, NUMBER)).success, true);
    assert.equal(captured!.url, `${URL}/factura/storno`);
  });

  test('missing credential fails before any request (fetch not called)', async () => {
    // configure everything the actions need except the private key
    await setSetting(db, 'fgo_cui', encrypt(CUI));
    await setSetting(db, 'fgo_platforma_url', encrypt(URL));
    captured = null;
    const res = await fgo.print(db, SERIE, NUMBER);
    assert.equal(res.success, false);
    assert.ok(/private_key|credential/i.test(res.error || ''), `unexpected error: ${res.error}`);
    assert.equal(captured, null, 'fetch must not be called');
  });
});

describe('FGO getConfigSchema', () => {
  test('requiredKeys include the emit credentials', () => {
    const schema = fgo.getConfigSchema();
    for (const k of [
      'fgo_cui',
      'fgo_private_key',
      'fgo_serie',
      'fgo_tip_factura',
      'fgo_platforma_url',
    ]) {
      assert.ok(schema.requiredKeys.includes(k), `${k} must be required`);
    }
  });

  test('private key field is of type password', () => {
    const schema = fgo.getConfigSchema();
    assert.equal(schema.fields!.fgo_private_key.type, 'password');
  });

  test('an environment field distinguishes test vs prod', () => {
    const schema = fgo.getConfigSchema();
    assert.equal(schema.fields!.fgo_environment.type, 'select');
    const values = (schema.fields!.fgo_environment.options || []).map((o) => o.value);
    assert.ok(values.includes('test'));
    assert.ok(values.includes('prod'));
  });
});
