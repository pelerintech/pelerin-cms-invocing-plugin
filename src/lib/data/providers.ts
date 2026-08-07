/**
 * Provider-configuration data accessor.
 *
 * Bridges the data-access layer (`settings.ts`) and the provider layer
 * (`providers/invoicing/registry.ts`).
 *
 * "Configured" means ready to actually emit — ALL keys in the provider's
 * `getConfigSchema().requiredKeys` are present AND non-empty after
 * `decryptIfNeeded`. This is the shared definition reused by the providers
 * list page, the API, and any guardrails.
 */
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import { getProvider } from '../../providers/invoicing/registry.ts';
import { getSetting, listSettingsForProvider } from './settings.ts';
import { decryptIfNeeded } from '../crypto.ts';

/** Mask a secret value to `****<last4>` (or `****` if length ≤ 4). */
function maskValue(value: string): string {
  if (value.length <= 4) return '****';
  return `****${value.slice(-4)}`;
}

/**
 * Get decrypted provider settings with password-type fields masked.
 * Keys use the full `${providerName}_` prefix (e.g. `fgo_cui`).
 */
export async function getProviderSettings(
  db: LibSQLDatabase,
  providerName: string
): Promise<Record<string, string>> {
  const provider = getProvider(providerName);
  const fields = provider?.getConfigSchema().fields;
  const prefix = `${providerName}_`;
  const stored = await listSettingsForProvider(db, providerName);
  const data: Record<string, string> = {};
  for (const [strippedKey, rawValue] of Object.entries(stored)) {
    const fullKey = `${prefix}${strippedKey}`;
    const decrypted = decryptIfNeeded(rawValue);
    const fieldType = fields?.[fullKey]?.type;
    data[fullKey] = fieldType === 'password' ? maskValue(decrypted) : decrypted;
  }
  return data;
}

/**
 * Returns true only when the named provider is registered, has at least one
 * required key, and every required key is present in settings with a
 * non-empty (decrypted, trimmed) value.
 */
export async function isProviderConfigured(
  db: LibSQLDatabase,
  providerName: string
): Promise<boolean> {
  const provider = getProvider(providerName);
  if (!provider) return false;

  const required = provider.getConfigSchema().requiredKeys;
  if (required.length === 0) return false;

  for (const key of required) {
    const raw = await getSetting(db, key);
    if (!raw) return false;
    const val = decryptIfNeeded(raw);
    if (!val || val.trim() === '') return false;
  }
  return true;
}
