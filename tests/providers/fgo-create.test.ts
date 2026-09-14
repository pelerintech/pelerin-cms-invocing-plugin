import { describe, test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { createTestDb } from '../db/harness.ts';
import { setSetting } from '../../src/lib/data/settings.ts';
import { encrypt } from '../../src/lib/crypto.ts';
import { fgo } from '../../src/providers/invoicing/fgo.ts';
import type { InvoiceDraft } from '../../src/providers/invoicing/interface.ts';

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
const SERIE = 'FGO2026';
const TIP = 'Factura';
const URL = 'https://api-testuat.fgo.ro/v1';

function configure(db: any) {
  return Promise.all([
    setSetting(db, 'fgo_cui', encrypt(CUI)),
    setSetting(db, 'fgo_private_key', encrypt(PRIVATE_KEY)),
    setSetting(db, 'fgo_serie', encrypt(SERIE)),
    setSetting(db, 'fgo_tip_factura', encrypt(TIP)),
    setSetting(db, 'fgo_platforma_url', encrypt(URL)),
  ]);
}

function draft(): InvoiceDraft {
  return {
    externalOrderId: 'order-42',
    currency: 'RON',
    issueDate: '2026-08-06',
    billTo: {
      name: 'SC Exemplu SRL',
      fiscalCode: 'RO12345678',
      address: 'Str. X 1',
      city: 'Bucuresti',
      country: 'RO',
      vatPayer: true,
    },
    lines: [
      {
        name: 'Widget',
        code: 'W-1',
        quantity: 2,
        unit: 'buc',
        unitPriceNet: 100,
        vatRate: 0.19,
        vatIncluded: false,
      },
      {
        name: 'Gadget',
        code: 'G-9',
        quantity: 1,
        unit: 'buc',
        unitPriceNet: 50,
        vatRate: 0.09,
        vatIncluded: false,
      },
    ],
  };
}

function sha1Hash(cui: string, key: string, name: string): string {
  return crypto.createHash('sha1').update(`${cui}${key}${name}`).digest('hex').toUpperCase();
}

describe('FGO create (stubbed fetch)', () => {
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
        json: async () => ({
          Success: true,
          Factura: { Serie: 'FGO2026', Numar: '42', Link: 'https://pdf' },
        }),
        text: async () => '',
      };
    };
  });
  afterEach(() => {
    delete (globalThis as any).fetch;
  });

  test('posts to /factura/emitere with the correct auth + series + client + lines', async () => {
    await configure(db);
    const result = await fgo.create(db, draft());
    assert.equal(result.success, true);
    assert.equal(result.series, 'FGO2026');
    assert.equal(result.number, '42');
    assert.equal(result.pdfLink, 'https://pdf');

    assert.ok(captured, 'fetch must have been called');
    assert.equal(captured!.url, `${URL}/factura/emitere`);

    const b = captured!.body;
    assert.equal(b.Serie, SERIE);
    assert.equal(b.Valuta, 'RON');
    assert.equal(b.TipFactura, TIP);
    assert.equal(b.PlatformaUrl, URL);
    assert.equal(b.IdExtern, 'order-42');
    assert.equal(b.VerificareDuplicat, true);
    assert.equal(b.Hash, sha1Hash(CUI, PRIVATE_KEY, 'SC Exemplu SRL'));
    // CodUnic must be the company CUI (used for the hash), NOT a UUID
    assert.equal(b.CodUnic, CUI);
    // The Hash must be recomputable from the values actually sent in the body
    // (same CodUnic + client Denumire) so FGO's own recomputation matches.
    assert.equal(b.Hash, sha1Hash(b.CodUnic, PRIVATE_KEY, b.Client.Denumire));

    // Client uses the FGO keys
    assert.equal(b.Client.Denumire, 'SC Exemplu SRL');
    assert.equal(b.Client.CodUnic, 'RO12345678');
    assert.equal(b.Client.Tip, 'PJ');
    assert.equal(b.Client.Tara, 'RO');
    assert.equal(b.Client.Localitate, 'Bucuresti');
    assert.equal(b.Client.Adresa, 'Str. X 1');
    assert.equal(b.Client.PlatitorTVA, true);

    // Per-client fields we cannot supply are omitted entirely
    assert.equal(b.Client.NrRegCom, undefined);
    assert.equal(b.Client.ContBancar, undefined);

    // Continut lines honor net-price + VAT-rate (CotaTVA as percentage)
    assert.equal(b.Continut.length, 2);
    assert.equal(b.Continut[0].Denumire, 'Widget');
    assert.equal(b.Continut[0].CodArticol, 'W-1');
    assert.equal(b.Continut[0].NrProduse, 2);
    assert.equal(b.Continut[0].UM, 'buc');
    assert.equal(b.Continut[0].PretUnitar, 100);
    assert.equal(b.Continut[0].CotaTVA, 19);
    assert.equal(b.Continut[1].CotaTVA, 9);

    // Invalid non-FGO keys are not sent
    assert.equal(b.Continut[0].Valoare, undefined);
    assert.equal(b.Continut[0].PretCuTVA, undefined);

    // Client old wrong keys are gone
    assert.equal(b.Client.Nume, undefined);
    assert.equal(b.Client.CUI, undefined);
    assert.equal(b.Client.CodTara, undefined);
    assert.equal(b.Client.Oras, undefined);
    assert.equal(b.Continut[0].Cant, undefined);
    assert.equal(b.Continut[0].Cod, undefined);
    assert.equal(b.Continut[0].Um, undefined);
  });

  test('PF client derived from an individual (no company) → Client.Tip = PF', async () => {
    await configure(db);
    const d = draft();
    d.billTo = { ...d.billTo, name: 'Ion Popescu', fiscalCode: '', vatPayer: false };
    const result = await fgo.create(db, d);
    assert.equal(result.success, true);
    assert.equal(captured!.body.Client.Tip, 'PF');
    assert.equal(captured!.body.Client.PlatitorTVA, false);
  });

  test('a line with no unit defaults UM to BUC', async () => {
    await configure(db);
    const d = draft();
    d.lines = [{ ...d.lines[0], unit: undefined }];
    const result = await fgo.create(db, d);
    assert.equal(result.success, true);
    assert.equal(captured!.body.Continut[0].UM, 'BUC');
  });

  test('Success:false maps to { success:false, error: Message }', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ Success: false, Message: 'Serie invalida' }),
      text: async () => '',
    });
    await configure(db);
    const result = await fgo.create(db, draft());
    assert.equal(result.success, false);
    assert.equal(result.error, 'Serie invalida');
  });

  test('network failure maps to { success:false, error }', async () => {
    globalThis.fetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    await configure(db);
    const result = await fgo.create(db, draft());
    assert.equal(result.success, false);
    assert.ok(result.error, 'an error message must be present');
  });

  test('missing private key → { success:false, error } about missing credential', async () => {
    // configure everything except the private key
    await setSetting(db, 'fgo_cui', encrypt(CUI));
    await setSetting(db, 'fgo_serie', encrypt(SERIE));
    await setSetting(db, 'fgo_tip_factura', encrypt(TIP));
    await setSetting(db, 'fgo_platforma_url', encrypt(URL));
    const result = await fgo.create(db, draft());
    assert.equal(result.success, false);
    assert.ok(
      /private_key|credential/i.test(result.error || ''),
      `unexpected error: ${result.error}`
    );
  });
});
