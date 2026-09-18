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

/** Load + decrypt the credentials needed for a request. Each operation lists exactly the keys it uses. */
async function loadCredentials(
  db: LibSQLDatabase,
  keys: string[]
): Promise<{ creds: Record<string, string>; missing: string | null }> {
  const values: Record<string, string | null> = {};
  for (const key of keys) {
    values[key] = await readSetting(db, key);
  }
  const missing = missingCredentials(values);
  return { creds: values as Record<string, string>, missing };
}

function missingCredentials(creds: Record<string, string | null>): string | null {
  const missing = Object.entries(creds)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length === 0) return null;
  return `FGO credentials not configured: ${missing.join(', ')}`;
}

export async function create(db: LibSQLDatabase, draft: InvoiceDraft): Promise<CreateResult> {
  const loaded = await loadCredentials(db, [
    'fgo_cui',
    'fgo_private_key',
    'fgo_serie',
    'fgo_tip_factura',
    'fgo_api_url',
    'fgo_platform_redirect_url',
  ]);
  if (loaded.missing) return { success: false, error: loaded.missing };
  const {
    fgo_cui: cui,
    fgo_private_key: key,
    fgo_serie: serie,
    fgo_tip_factura: tip,
    fgo_api_url: apiUrl,
    fgo_platform_redirect_url: platformUrl,
  } = loaded.creds;

  const body = {
    CodUnic: cui,
    Hash: hashAuth(cui, key, draft.billTo.name),
    Serie: serie,
    Valuta: draft.currency,
    // default to the canonical FGO invoice type when unset
    TipFactura: tip || 'Factura',
    DataEmitere: draft.issueDate,
    Client: {
      Denumire: draft.billTo.name,
      CodUnic: draft.billTo.fiscalCode || undefined,
      // PJ when the client is a company / VAT payer, else PF (individual)
      Tip: draft.billTo.vatPayer ? 'PJ' : 'PF',
      Tara: draft.billTo.country,
      Adresa: draft.billTo.address,
      Localitate: draft.billTo.city,
      ...(draft.billTo.county ? { Judet: draft.billTo.county } : {}),
      ...(draft.billTo.email ? { Email: draft.billTo.email } : {}),
      ...(draft.billTo.phone ? { Telefon: draft.billTo.phone } : {}),
      // per-client legal/bank fields (NrRegCom, ContBancar) are intentionally
      // omitted — no per-customer source; FGO derives them from the client CUI.
      PlatitorTVA: draft.billTo.vatPayer,
    },
    Continut: draft.lines.map((line) => ({
      Denumire: line.name,
      CodArticol: line.code,
      NrProduse: line.quantity,
      UM: line.unit || 'BUC',
      CotaTVA: Math.round((line.vatRate || 0) * 100),
      PretUnitar: line.unitPriceNet,
    })),
    // PlatformaUrl is the root of OUR app (customer confirmation site), not the FGO API host.
    PlatformaUrl: platformUrl,
    IdExtern: draft.externalOrderId,
    VerificareDuplicat: true,
  };

  try {
    const data = await postJson<FgoResponse>(`${apiUrl}/factura/emitere`, body);
    if (data && data.Success === true) {
      return {
        success: true,
        series: data.Factura?.Serie,
        number: data.Factura?.Numar,
        pdfLink: data.Factura?.Link,
        request: body,
        response: data,
      };
    }
    return {
      success: false,
      error: data?.Message || 'FGO emit failed',
      request: body,
      response: data,
    };
  } catch (err) {
    return { success: false, error: String((err as Error).message || err), request: body };
  }
}

/** Credentials the non-create actions actually need (no emit-only serie/tip). */
const ACTION_KEYS = ['fgo_cui', 'fgo_private_key', 'fgo_api_url', 'fgo_platform_redirect_url'];

export async function print(
  db: LibSQLDatabase,
  series: string,
  number: string
): Promise<PrintResult> {
  const loaded = await loadCredentials(db, ACTION_KEYS);
  if (loaded.missing) return { success: false, error: loaded.missing };
  const {
    fgo_cui: cui,
    fgo_private_key: key,
    fgo_api_url: apiUrl,
    fgo_platform_redirect_url: platformUrl,
  } = loaded.creds;

  const body = {
    CodUnic: cui,
    Numar: number,
    Serie: series,
    Hash: hashAuth(cui, key, number),
    PlatformaUrl: platformUrl,
  };
  try {
    const data = await postJson<FgoResponse>(`${apiUrl}/factura/pdf`, body);
    if (data && data.Success === true) {
      return {
        success: true,
        pdfLink: data.Factura?.Link || data.Link,
        request: body,
        response: data,
      };
    }
    return {
      success: false,
      error: data?.Message || 'FGO print failed',
      request: body,
      response: data,
    };
  } catch (err) {
    return { success: false, error: String((err as Error).message || err), request: body };
  }
}

export async function cancel(
  db: LibSQLDatabase,
  series: string,
  number: string
): Promise<CancelResult> {
  const loaded = await loadCredentials(db, ACTION_KEYS);
  if (loaded.missing) return { success: false, error: loaded.missing };
  const {
    fgo_cui: cui,
    fgo_private_key: key,
    fgo_api_url: apiUrl,
    fgo_platform_redirect_url: platformUrl,
  } = loaded.creds;

  const body = {
    CodUnic: cui,
    Numar: number,
    Serie: series,
    Hash: hashAuth(cui, key, number),
    PlatformaUrl: platformUrl,
  };
  try {
    const data = await postJson<FgoResponse>(`${apiUrl}/factura/anulare`, body);
    if (data && data.Success === true) {
      return { success: true, request: body, response: data };
    }
    return {
      success: false,
      error: data?.Message || 'FGO cancel failed',
      request: body,
      response: data,
    };
  } catch (err) {
    return { success: false, error: String((err as Error).message || err), request: body };
  }
}

export async function storno(
  db: LibSQLDatabase,
  series: string,
  number: string
): Promise<StornoResult> {
  const loaded = await loadCredentials(db, ACTION_KEYS);
  if (loaded.missing) return { success: false, error: loaded.missing };
  const {
    fgo_cui: cui,
    fgo_private_key: key,
    fgo_api_url: apiUrl,
    fgo_platform_redirect_url: platformUrl,
  } = loaded.creds;

  const body = {
    CodUnic: cui,
    Numar: number,
    Serie: series,
    Hash: hashAuth(cui, key, number),
    PlatformaUrl: platformUrl,
  };
  try {
    const data = await postJson<FgoResponse>(`${apiUrl}/factura/storno`, body);
    if (data && data.Success === true) {
      return {
        success: true,
        seriesStorno: data.Factura?.SerieStorno || data.SerieStorno,
        numberStorno: data.Factura?.NumarStorno || data.NumarStorno,
        request: body,
        response: data,
      };
    }
    return {
      success: false,
      error: data?.Message || 'FGO storno failed',
      request: body,
      response: data,
    };
  } catch (err) {
    return { success: false, error: String((err as Error).message || err), request: body };
  }
}

export function getConfigSchema(): ProviderConfigSchema {
  return {
    requiredKeys: [
      'fgo_cui',
      'fgo_private_key',
      'fgo_serie',
      'fgo_tip_factura',
      'fgo_api_url',
      'fgo_platform_redirect_url',
    ],
    fields: {
      fgo_api_url: {
        type: 'text',
        label: 'FGO API URL',
        description:
          'FGO API base URL the plugin posts to. Test: https://api-testuat.fgo.ro/v1 | Production: https://api.fgo.ro/v1.',
        default: 'https://api-testuat.fgo.ro/v1',
        placeholder: 'https://api-testuat.fgo.ro/v1',
      },
      fgo_platform_redirect_url: {
        type: 'text',
        label: 'Platform URL',
        description:
          'Root URL of your application (customer confirmation site/app). Sent to FGO as PlatformaUrl so it is NOT the FGO API host.',
        placeholder: 'https://yourapp.com',
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
