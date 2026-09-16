import { test } from 'node:test';
import assert from 'node:assert';
import type {
  CreateResult,
  PrintResult,
  CancelResult,
  StornoResult,
} from '../../src/providers/invoicing/interface.ts';

/**
 * The provider interface result types carry the captured request/response so
 * the adapter can surface exactly what it sent and what the provider returned
 * (for debugging a failing FGO hash). `request`/`response` are optional so a
 * provider that forgets to attach them simply stores null (no crash).
 */
test('result types type-check with optional request/response', () => {
  const create: CreateResult = {
    success: true,
    series: 'FGO',
    number: '1',
    request: { CodUnic: 'RO1', Hash: 'ABC' },
    response: { Success: true, Factura: { Serie: 'FGO', Numar: '1' } },
  };
  const createFailure: CreateResult = {
    success: false,
    error: 'Hash-ul transmis nu este corect',
    request: { CodUnic: 'RO1' },
    response: { Success: false, Message: 'Hash-ul transmis nu este corect' },
  };
  const print: PrintResult = {
    success: true,
    pdfLink: 'https://pdf',
    request: { Serie: 'FGO', Numar: '1', Hash: 'ABC' },
    response: { Success: true, Factura: { Link: 'https://pdf' } },
  };
  const cancel: CancelResult = {
    success: true,
    request: { Serie: 'FGO', Numar: '1' },
    response: { Success: true },
  };
  const storno: StornoResult = {
    success: true,
    seriesStorno: 'FGO',
    numberStorno: '2',
    request: { Serie: 'FGO', Numar: '1' },
    response: { Success: true, Factura: { SerieStorno: 'FGO', NumarStorno: '2' } },
  };

  assert.equal(create.success, true);
  assert.equal(createFailure.success, false);
  assert.equal(print.pdfLink, 'https://pdf');
  assert.equal(cancel.success, true);
  assert.equal(storno.numberStorno, '2');
});
