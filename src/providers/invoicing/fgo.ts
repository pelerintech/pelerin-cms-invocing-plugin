/**
 * FGO invoicing adapter (v7.0 contract).
 *
 * The first invoicing provider. FGO-specific quirks — SHA-1 hash auth,
 * `Serie`, `IdExtern` + `VerificareDuplicat` idempotency, 1 req/s rate limit,
 * 15s timeout — stay inside this adapter.
 *
 * Credentials are read from `invoicing_settings` (fgo_* keys) via the injected
 * `db`, exactly like the notifications providers read their own settings.
 */
import crypto from 'node:crypto';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type {
  InvoicingProvider,
  InvoiceDraft,
  CreateResult,
  PrintResult,
  CancelResult,
  StornoResult,
  ProviderConfigSchema,
} from './interface.ts';
import { getSetting } from '../../lib/data/settings.ts';
import { decryptIfNeeded } from '../../lib/crypto.ts';
import { registerProvider } from './registry.ts';

const TIMEOUT_MS = 15000;

/** FGO API response envelope (subset of fields this adapter reads). */
interface FgoFactura {
  Serie?: string;
  Numar?: string;
  Link?: string;
  SerieStorno?: string;
  NumarStorno?: string;
}
interface FgoResponse {
  Success?: boolean;
  Message?: string;
  Factura?: FgoFactura;
  Serie?: string;
  Numar?: string;
  Link?: string;
  SerieStorno?: string;
  NumarStorno?: string;
}

/** Read + decrypt a provider setting, or null. */
async function readSetting(db: LibSQLDatabase, key: string): Promise<string | null> {
  const raw = await getSetting(db, key);
  if (!raw) return null;
  return decryptIfNeeded(raw);
}

function hashAuth(cui: string, key: string, value: string): string {
  return crypto.createHash('sha1').update(`${cui}${key}${value}`).digest('hex').toUpperCase();
}

/** POST JSON with a timeout. Throws on network error / timeout. */
async function postJson<T extends object>(url: string, body: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Load the credentials needed to authenticate a request. */
async function loadCredentials(db: LibSQLDatabase) {
  const [cui, key, serie, tip, url] = await Promise.all([
    readSetting(db, 'fgo_cui'),
    readSetting(db, 'fgo_private_key'),
    readSetting(db, 'fgo_serie'),
    readSetting(db, 'fgo_tip_factura'),
    readSetting(db, 'fgo_platforma_url'),
  ]);
  return { cui, key, serie, tip, url };
}

function missingCredentials(creds: Record<string, string | null>): string | null {
  const missing = Object.entries(creds)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length === 0) return null;
  return `FGO credentials not configured: ${missing.join(', ')}`;
}

export async function create(db: LibSQLDatabase, draft: InvoiceDraft): Promise<CreateResult> {
  const creds = await loadCredentials(db);
  const missing = missingCredentials(creds);
  if (missing) return { success: false, error: missing };
  const { cui, key, serie, tip, url } = creds as Record<string, string>;

  const body = {
    CodUnic: crypto.randomUUID(),
    Hash: hashAuth(cui, key, draft.billTo.name),
    Serie: serie,
    Valuta: draft.currency,
    TipFactura: tip,
    DataEmitere: draft.issueDate,
    Client: {
      Nume: draft.billTo.name,
      CUI: draft.billTo.fiscalCode || undefined,
      CodTara: draft.billTo.country,
      Adresa: draft.billTo.address,
      Oras: draft.billTo.city,
      ...(draft.billTo.county ? { Judet: draft.billTo.county } : {}),
      ...(draft.billTo.email ? { Email: draft.billTo.email } : {}),
      ...(draft.billTo.phone ? { Telefon: draft.billTo.phone } : {}),
    },
    Continut: draft.lines.map((line) => ({
      Cod: line.code,
      Denumire: line.name,
      Um: line.unit,
      Cant: line.quantity,
      PretUnitar: line.unitPriceNet,
      Valoare: line.unitPriceNet * line.quantity,
      CotaTVA: Math.round((line.vatRate || 0) * 100),
      // net price is exclusive of VAT unless the draft says otherwise
      PretCuTVA: line.vatIncluded || false,
    })),
    PlatformaUrl: url,
    IdExtern: draft.externalOrderId,
    VerificareDuplicat: true,
  };

  try {
    const data = await postJson<FgoResponse>(`${url}/factura/emitere`, body);
    if (data && data.Success === true) {
      return {
        success: true,
        series: data.Factura?.Serie,
        number: data.Factura?.Numar,
        pdfLink: data.Factura?.Link,
      };
    }
    return { success: false, error: data?.Message || 'FGO emit failed' };
  } catch (err) {
    return { success: false, error: String((err as Error).message || err) };
  }
}

export async function print(
  db: LibSQLDatabase,
  series: string,
  number: string
): Promise<PrintResult> {
  const creds = await loadCredentials(db);
  const missing = missingCredentials(creds);
  if (missing) return { success: false, error: missing };
  const { cui, key, url } = creds as Record<string, string>;

  const body = {
    Serie: series,
    Hash: hashAuth(cui, key, number),
    PlatformaUrl: url,
  };
  try {
    const data = await postJson<FgoResponse>(`${url}/factura/pdf`, body);
    if (data && data.Success === true) {
      return { success: true, pdfLink: data.Factura?.Link || data.Link };
    }
    return { success: false, error: data?.Message || 'FGO print failed' };
  } catch (err) {
    return { success: false, error: String((err as Error).message || err) };
  }
}

export async function cancel(
  db: LibSQLDatabase,
  series: string,
  number: string
): Promise<CancelResult> {
  const creds = await loadCredentials(db);
  const missing = missingCredentials(creds);
  if (missing) return { success: false, error: missing };
  const { cui, key, url } = creds as Record<string, string>;

  const body = {
    Serie: series,
    Hash: hashAuth(cui, key, number),
    PlatformaUrl: url,
  };
  try {
    const data = await postJson<FgoResponse>(`${url}/factura/anulare`, body);
    if (data && data.Success === true) {
      return { success: true };
    }
    return { success: false, error: data?.Message || 'FGO cancel failed' };
  } catch (err) {
    return { success: false, error: String((err as Error).message || err) };
  }
}

export async function storno(
  db: LibSQLDatabase,
  series: string,
  number: string
): Promise<StornoResult> {
  const creds = await loadCredentials(db);
  const missing = missingCredentials(creds);
  if (missing) return { success: false, error: missing };
  const { cui, key, url } = creds as Record<string, string>;

  const body = {
    Serie: series,
    Hash: hashAuth(cui, key, number),
    PlatformaUrl: url,
  };
  try {
    const data = await postJson<FgoResponse>(`${url}/factura/storno`, body);
    if (data && data.Success === true) {
      return {
        success: true,
        seriesStorno: data.Factura?.SerieStorno || data.SerieStorno,
        numberStorno: data.Factura?.NumarStorno || data.NumarStorno,
      };
    }
    return { success: false, error: data?.Message || 'FGO storno failed' };
  } catch (err) {
    return { success: false, error: String((err as Error).message || err) };
  }
}

export function getConfigSchema(): ProviderConfigSchema {
  return {
    requiredKeys: [
      'fgo_cui',
      'fgo_private_key',
      'fgo_serie',
      'fgo_tip_factura',
      'fgo_platforma_url',
    ],
    fields: {
      fgo_environment: {
        type: 'select',
        label: 'Environment',
        description: 'Test (api-testuat.fgo.ro) or production (api.fgo.ro).',
        default: 'test',
        options: [
          { value: 'test', label: 'Test' },
          { value: 'prod', label: 'Production' },
        ],
      },
      fgo_platforma_url: {
        type: 'text',
        label: 'Platform URL',
        description: 'FGO API base URL (e.g. https://api-testuat.fgo.ro/v1).',
        default: 'https://api-testuat.fgo.ro/v1',
        placeholder: 'https://api-testuat.fgo.ro/v1',
      },
      fgo_cui: {
        type: 'text',
        label: 'CUI (fiscal code)',
        description: 'Your company CUI, e.g. RO12345678.',
        placeholder: 'RO12345678',
      },
      fgo_private_key: {
        type: 'password',
        label: 'Private key',
        description: 'FGO private key used to sign requests.',
        placeholder: '••••••••••',
      },
      fgo_serie: {
        type: 'text',
        label: 'Serie',
        description: 'Invoice series to emit under.',
        placeholder: 'FGO2026',
      },
      fgo_tip_factura: {
        type: 'text',
        label: 'Invoice type',
        description: 'FGO invoice type (FACTURA, PROCESAREA...).',
        default: 'FACTURA',
        placeholder: 'FACTURA',
      },
    },
  };
}

export const fgo: InvoicingProvider = {
  name: 'fgo',
  getConfigSchema,
  create,
  print,
  cancel,
  storno,
};

registerProvider(fgo);
