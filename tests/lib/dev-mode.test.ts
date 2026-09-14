import { describe, test } from 'node:test';
import assert from 'node:assert';
import { isDevMode } from '../../src/lib/dev-mode.ts';

describe('isDevMode (INVOICING_DEV_MODE gate)', () => {
  test('env unset → dev mode off', () => {
    assert.equal(isDevMode({ importMeta: {}, process: {} }), false);
  });

  test("env exactly 'true' → dev mode on", () => {
    assert.equal(isDevMode({ importMeta: {}, process: { INVOICING_DEV_MODE: 'true' } }), true);
  });

  test("any other value ('1', 'yes', 'TRUE') → dev mode off", () => {
    for (const v of ['1', 'yes', 'TRUE']) {
      assert.equal(
        isDevMode({ importMeta: {}, process: { INVOICING_DEV_MODE: v } }),
        false,
        `value '${v}' must not enable dev mode`
      );
    }
  });

  test('import.meta.env takes precedence over process.env', () => {
    assert.equal(
      isDevMode({
        importMeta: { INVOICING_DEV_MODE: 'false' },
        process: { INVOICING_DEV_MODE: 'true' },
      }),
      false
    );
  });

  test('injectable env source works under bare Node (no import.meta.env)', () => {
    assert.equal(isDevMode({ importMeta: {}, process: { INVOICING_DEV_MODE: 'true' } }), true);
  });
});
