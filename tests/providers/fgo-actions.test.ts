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
const API_URL = 'https://api-testuat.fgo.ro/v1';
const PLATFORM_URL = 'https://yourapp.com';
const SERIE = 'FGO2026';
const NUMBER = '42';

function configure(db: any) {
  return Promise.all([
    setSetting(db, 'fgo_cui', encrypt(CUI)),
    setSetting(db, 'fgo_private_key', encrypt(PRIVATE_KEY)),
    setSetting(db, 'fgo_serie', encrypt(SERIE)),
    setSetting(db, 'fgo_tip_factura', encrypt('FACTURA')),
    setSetting(db, 'fgo_api_url', encrypt(API_URL)),
    setSetting(db, 'fgo_platform_redirect_url', encrypt(PLATFORM_URL)),
  ]);
}

function sha1Hash(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex').toUpperCase();
}

/** A minimal `Response`-like JSON stub for the new text-first postJson. */
function jsonResponse(body: unknown, status = 200): any {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) =>
        String(name).toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    text: async () => JSON.stringify(body),
  };
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
      return jsonResponse({ Success: true, Factura: {} });
    };
  });
  afterEach(() => {
    delete (globalThis as any).fetch;
  });

  test('print posts /factura/pdf with Hash=SHA1(CUI+key+number) and returns pdfLink', async () => {
    globalThis.fetch = async (url: string, options: any) => {
      captured = { url, body: JSON.parse(options.body) };
      return jsonResponse({ Success: true, Factura: { Link: 'https://pdf' } });
    };
    await configure(db);
    const result = await fgo.print(db, SERIE, NUMBER);
    assert.equal(result.success, true);
    assert.equal(result.pdfLink, 'https://pdf');
    assert.equal(captured!.url, `${API_URL}/factura/pdf`);
    assert.equal(captured!.body.Hash, sha1Hash(`${CUI}${PRIVATE_KEY}${NUMBER}`));
    assert.equal(captured!.body.Serie, SERIE);
    assert.equal(captured!.body.CodUnic, CUI);
    assert.equal(captured!.body.Numar, NUMBER);
    assert.equal(captured!.body.PlatformaUrl, PLATFORM_URL);
    assert.deepEqual(result.request, captured!.body);
    assert.deepEqual(result.response, { Success: true, Factura: { Link: 'https://pdf' } });
  });

  test('cancel posts the cancel endpoint and returns success', async () => {
    await configure(db);
    const result = await fgo.cancel(db, SERIE, NUMBER);
    assert.equal(result.success, true);
    assert.equal(captured!.url, `${API_URL}/factura/anulare`);
    assert.equal(captured!.body.Hash, sha1Hash(`${CUI}${PRIVATE_KEY}${NUMBER}`));
    assert.equal(captured!.body.CodUnic, CUI);
    assert.equal(captured!.body.Numar, NUMBER);
    assert.equal(captured!.body.Serie, SERIE);
    assert.deepEqual(result.request, captured!.body);
    assert.deepEqual(result.response, { Success: true, Factura: {} });
  });

  test('storno returns success + storno refs', async () => {
    globalThis.fetch = async (url: string, options: any) => {
      captured = { url, body: JSON.parse(options.body) };
      return jsonResponse({
        Success: true,
        Factura: { SerieStorno: 'FGO2026', NumarStorno: '43' },
      });
    };
    await configure(db);
    const result = await fgo.storno(db, SERIE, NUMBER);
    assert.equal(result.success, true);
    assert.equal(result.seriesStorno, 'FGO2026');
    assert.equal(result.numberStorno, '43');
    assert.equal(captured!.body.CodUnic, CUI);
    assert.equal(captured!.body.Numar, NUMBER);
    assert.equal(captured!.body.Serie, SERIE);
    assert.deepEqual(result.request, captured!.body);
    assert.deepEqual(result.response, {
      Success: true,
      Factura: { SerieStorno: 'FGO2026', NumarStorno: '43' },
    });
  });

  test('provider error → { success:false, error }', async () => {
    globalThis.fetch = async (url: string, options: any) => {
      captured = { url, body: JSON.parse(options.body) };
      return jsonResponse({ Success: false, Message: 'Nu exista factura' });
    };
    await configure(db);
    const pr = await fgo.print(db, SERIE, NUMBER);
    assert.equal(pr.success, false);
    assert.deepEqual(pr.request, captured!.body);
    assert.deepEqual(pr.response, { Success: false, Message: 'Nu exista factura' });
    const ca = await fgo.cancel(db, SERIE, NUMBER);
    assert.equal(ca.success, false);
    assert.deepEqual(ca.request, captured!.body);
    assert.deepEqual(ca.response, { Success: false, Message: 'Nu exista factura' });
    const st = await fgo.storno(db, SERIE, NUMBER);
    assert.equal(st.success, false);
    assert.ok(st.error, 'an error message must be set');
    assert.deepEqual(st.request, captured!.body);
    assert.deepEqual(st.response, { Success: false, Message: 'Nu exista factura' });
  });

  test('network failure → { success:false, error } and returns the request body', async () => {
    globalThis.fetch = async (url: string, options: any) => {
      captured = { url, body: JSON.parse(options.body) };
      throw new Error('TIMEOUT');
    };
    await configure(db);
    const pr = await fgo.print(db, SERIE, NUMBER);
    assert.equal(pr.success, false);
    assert.deepEqual(pr.request, captured!.body);
    assert.equal(pr.response, undefined);
  });

  test('actions run with only cui/private_key/url configured (serie/tip unneeded)', async () => {
    // Actions only need the auth trio; the emit-only fgo_serie/fgo_tip_factura
    // keys must not block print/cancel/storno.
    await setSetting(db, 'fgo_cui', encrypt(CUI));
    await setSetting(db, 'fgo_private_key', encrypt(PRIVATE_KEY));
    await setSetting(db, 'fgo_api_url', encrypt(API_URL));
    await setSetting(db, 'fgo_platform_redirect_url', encrypt(PLATFORM_URL));

    assert.equal((await fgo.print(db, SERIE, NUMBER)).success, true);
    assert.equal(captured!.url, `${API_URL}/factura/pdf`);
    assert.equal(captured!.body.PlatformaUrl, PLATFORM_URL);
    assert.equal((await fgo.cancel(db, SERIE, NUMBER)).success, true);
    assert.equal(captured!.url, `${API_URL}/factura/anulare`);
    assert.equal(captured!.body.PlatformaUrl, PLATFORM_URL);
    assert.equal((await fgo.storno(db, SERIE, NUMBER)).success, true);
    assert.equal(captured!.url, `${API_URL}/factura/storno`);
    assert.equal(captured!.body.PlatformaUrl, PLATFORM_URL);
  });

  test('missing credential fails before any request (fetch not called)', async () => {
    // configure everything the actions need except the private key
    await setSetting(db, 'fgo_cui', encrypt(CUI));
    await setSetting(db, 'fgo_api_url', encrypt(API_URL));
    await setSetting(db, 'fgo_platform_redirect_url', encrypt(PLATFORM_URL));
    captured = null;
    const res = await fgo.print(db, SERIE, NUMBER);
    assert.equal(res.success, false);
    assert.ok(/private_key|credential/i.test(res.error || ''), `unexpected error: ${res.error}`);
    assert.equal(captured, null, 'fetch must not be called');
  });
});

describe('FGO getConfigSchema', () => {
  test('requiredKeys include the new URL settings and exclude legacy/environment', () => {
    const schema = fgo.getConfigSchema();
    for (const k of [
      'fgo_cui',
      'fgo_private_key',
      'fgo_serie',
      'fgo_tip_factura',
      'fgo_api_url',
      'fgo_platform_redirect_url',
    ]) {
      assert.ok(schema.requiredKeys.includes(k), `${k} must be required`);
    }
    assert.ok(
      !schema.requiredKeys.includes('fgo_platforma_url'),
      'legacy key must not be required'
    );
    assert.ok(
      !schema.requiredKeys.includes('fgo_environment'),
      'environment key must not be required'
    );
  });

  test('private key field is of type password', () => {
    const schema = fgo.getConfigSchema();
    assert.equal(schema.fields!.fgo_private_key.type, 'password');
  });

  test('two distinct URL fields: fgo_api_url and fgo_platform_redirect_url', () => {
    const schema = fgo.getConfigSchema();
    assert.equal(schema.fields!.fgo_api_url.type, 'text');
    assert.equal(schema.fields!.fgo_platform_redirect_url.type, 'text');
  });

  test('fgo_api_url help text names the test and prod hosts', () => {
    const schema = fgo.getConfigSchema();
    const d = schema.fields!.fgo_api_url.description;
    assert.ok(/api-testuat\.fgo\.ro/.test(d), 'help text must name the test host');
    assert.ok(/api\.fgo\.ro/.test(d), 'help text must name the prod host');
  });

  test('fgo_platform_redirect_url help text describes the app root (not the FGO host)', () => {
    const schema = fgo.getConfigSchema();
    const d = schema.fields!.fgo_platform_redirect_url.description;
    assert.ok(/root of your application|root URL of your application/i.test(d));
  });

  test('legacy and environment fields are removed', () => {
    const schema = fgo.getConfigSchema();
    assert.equal(schema.fields!.fgo_environment, undefined);
    assert.equal(schema.fields!.fgo_platforma_url, undefined);
  });
});
