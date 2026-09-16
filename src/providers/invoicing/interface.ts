/**
 * Invoicing provider interface.
 *
 * External invoicing systems sit behind this pluggable interface. Each
 * provider implements the methods below and reads its own credentials from
 * the `invoicing_settings` table via the injected `db`.
 *
 * See design.md / providers spec for the full pattern (mirrors the ecomm
 * payment-provider and notifications provider patterns).
 */
import type { LibSQLDatabase } from 'drizzle-orm/libsql';

/** A provider-normalized bill-to client (PF or PJ). */
export interface InvoiceBillTo {
  name: string;
  fiscalCode: string;
  address: string;
  city: string;
  county?: string;
  country: string;
  email?: string;
  phone?: string;
  vatPayer: boolean;
}

/** A provider-normalized line item. */
export interface InvoiceLine {
  name: string;
  code?: string;
  quantity: number;
  unit?: string;
  unitPriceNet: number;
  vatRate: number;
  vatIncluded: boolean;
}

/**
 * Canonical, provider-neutral invoice draft. Built once from the self-contained
 * order payload; each adapter maps this to its own JSON shape.
 */
export interface InvoiceDraft {
  externalOrderId: string;
  currency: string;
  issueDate: string;
  billTo: InvoiceBillTo;
  lines: InvoiceLine[];
  /** Left for the provider/config — not populated from the payload. */
  seriesName?: string;
}

export interface CreateResult {
  success: boolean;
  series?: string;
  number?: string;
  pdfLink?: string;
  error?: string;
  /** The exact request body the adapter built and sent. */
  request?: unknown;
  /** The parsed provider response envelope (undefined on a network error). */
  response?: unknown;
}

export interface PrintResult {
  success: boolean;
  pdfLink?: string;
  error?: string;
  request?: unknown;
  response?: unknown;
}

export interface CancelResult {
  success: boolean;
  error?: string;
  request?: unknown;
  response?: unknown;
}

export interface StornoResult {
  success: boolean;
  seriesStorno?: string;
  numberStorno?: string;
  error?: string;
  request?: unknown;
  response?: unknown;
}

export interface ProviderConfigField {
  type: string;
  label: string;
  description: string;
  default?: string;
  placeholder?: string;
  /** Options for `select`-type fields. */
  options?: { value: string; label: string }[];
}

export interface ProviderConfigSchema {
  requiredKeys: string[];
  fields?: Record<string, ProviderConfigField>;
}

export interface InvoicingProvider {
  name: string;
  getConfigSchema(): ProviderConfigSchema;
  /** Create/emit an invoice from the canonical draft. */
  create(db: LibSQLDatabase, draft: InvoiceDraft): Promise<CreateResult>;
  /** Fetch the PDF for an issued invoice. */
  print(db: LibSQLDatabase, series: string, number: string): Promise<PrintResult>;
  /** Cancel (anulare) an issued invoice. */
  cancel(db: LibSQLDatabase, series: string, number: string): Promise<CancelResult>;
  /** Reversing entry (storno) for an issued invoice. */
  storno(db: LibSQLDatabase, series: string, number: string): Promise<StornoResult>;
}
