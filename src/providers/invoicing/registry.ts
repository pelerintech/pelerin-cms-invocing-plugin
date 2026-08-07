import type { InvoicingProvider } from './interface.ts';

const providers = new Map<string, InvoicingProvider>();

/** Register an invoicing provider. Throws if a name is already registered. */
export function registerProvider(provider: InvoicingProvider): void {
  if (!provider || typeof provider.name !== 'string') {
    throw new Error('Provider must have a name property');
  }
  if (providers.has(provider.name)) {
    throw new Error(`Provider "${provider.name}" is already registered`);
  }
  providers.set(provider.name, provider);
}

/** Get a registered provider by name, or null. */
export function getProvider(name: string): InvoicingProvider | null {
  return providers.get(name) || null;
}

/** List all registered provider names. */
export function listProviders(): string[] {
  return [...providers.keys()];
}

/** List all registered provider objects. */
export function listProviderObjects(): InvoicingProvider[] {
  return [...providers.values()];
}
