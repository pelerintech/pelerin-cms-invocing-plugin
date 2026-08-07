import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import { encrypt, decrypt, isEncrypted, decryptIfNeeded } from '../../src/lib/crypto.ts';

const KEY = 'test-encryption-key-32+chars-long';
const originalKey = process.env.INVOICING_ENCRYPTION_KEY;

before(() => {
  process.env.INVOICING_ENCRYPTION_KEY = KEY;
});

after(() => {
  if (originalKey === undefined) {
    delete process.env.INVOICING_ENCRYPTION_KEY;
  } else {
    process.env.INVOICING_ENCRYPTION_KEY = originalKey;
  }
});

describe('crypto module (invoicing)', () => {
  test('decrypt(encrypt(x)) round-trips the original value', () => {
    assert.strictEqual(decrypt(encrypt('fgo-private-key-123')), 'fgo-private-key-123');
  });

  test('isEncrypted(encrypt(x)) is true and isEncrypted("plain") is false', () => {
    assert.strictEqual(isEncrypted(encrypt('x')), true);
    assert.strictEqual(isEncrypted('plain'), false);
  });

  test('decryptIfNeeded returns plaintext unchanged and decrypts ciphertext', () => {
    assert.strictEqual(decryptIfNeeded('plain'), 'plain');
    assert.strictEqual(decryptIfNeeded(encrypt('secret')), 'secret');
  });

  test('two encryptions of the same value differ (random IV) but both decrypt', () => {
    const a = encrypt('same');
    const b = encrypt('same');
    assert.notStrictEqual(a, b);
    assert.strictEqual(decrypt(a), 'same');
    assert.strictEqual(decrypt(b), 'same');
  });

  test('ciphertext in the store is not the raw secret', () => {
    const secret = 'fgo-super-secret';
    const cipher = encrypt(secret);
    assert.notStrictEqual(cipher, secret);
    assert.ok(!cipher.includes(secret));
    assert.strictEqual(isEncrypted(cipher), true);
  });

  test('encrypt throws mentioning the missing key when env var is absent', () => {
    delete process.env.INVOICING_ENCRYPTION_KEY;
    assert.throws(() => encrypt('x'), /encryption key/i);
    process.env.INVOICING_ENCRYPTION_KEY = KEY;
  });

  test('decrypt throws when env var is absent', () => {
    encrypt('a:b:c-sentinel');
    delete process.env.INVOICING_ENCRYPTION_KEY;
    assert.throws(() => decrypt('a:b:c'), /encryption key/i);
    process.env.INVOICING_ENCRYPTION_KEY = KEY;
  });

  test('encrypt produces v2-prefixed ciphertext with 5 parts', () => {
    const enc = encrypt('my-secret');
    assert.ok(enc.startsWith('v2:'), 'encrypted value must start with v2:');
    const parts = enc.split(':');
    assert.strictEqual(parts.length, 5, 'v2 ciphertext must have 5 colon-separated parts');
  });

  test('decrypt recovers a v2-encrypted value', () => {
    assert.strictEqual(decrypt(encrypt('my-secret')), 'my-secret');
  });

  test('tampered v2 ciphertext throws', () => {
    const enc = encrypt('my-secret');
    const parts = enc.split(':');
    const ct = parts[4];
    const flipped = ct.slice(0, -1) + (ct[ct.length - 1] === '0' ? '1' : '0');
    const tampered = parts.slice(0, 4).join(':') + ':' + flipped;
    assert.throws(() => decrypt(tampered), /auth.?tag|Unsupported|tag/i);
  });

  test('decryptIfNeeded handles both formats', () => {
    const plain = 'some-plain-value';
    const v2Enc = encrypt(plain);
    assert.strictEqual(decryptIfNeeded(v2Enc), plain, 'decryptIfNeeded must handle v2');
    assert.strictEqual(decryptIfNeeded(plain), plain, 'decryptIfNeeded must pass through plain');
  });

  test('v1 legacy format decrypt recovers original plaintext', () => {
    const plaintext = 'legacy-test-value';
    const key = crypto.createHash('sha256').update(KEY).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv) as crypto.CipherGCM;
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const v1Value = `${iv.toString('hex')}:${authTag.toString('hex')}:${ct.toString('hex')}`;
    assert.ok(!v1Value.startsWith('v2:'), 'v1 value should not have v2: prefix');
    assert.strictEqual(decrypt(v1Value), plaintext);
  });
});
