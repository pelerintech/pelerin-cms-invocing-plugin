/**
 * Encryption utilities for provider credentials.
 *
 * AES-256-GCM via Node's built-in `crypto`.
 * Uses scrypt KDF (v2 format) for new encryptions; backward-compatible
 * with legacy v1 (SHA-256) format for existing ciphertext.
 *
 * v2 format: v2:<ivHex>:<saltHex>:<authTagHex>:<ctHex>
 * v1 format: <ivHex>:<authTagHex>:<ctHex> (SHA-256, legacy)
 *
 * The env key is `INVOICING_ENCRYPTION_KEY` (own key, separate from the
 * notifications plugin).
 */
import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

const SALT_BYTES = 16;

/** Legacy SHA-256 key derivation (v1 format). */
function deriveKeyV1(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret).digest();
}

/** scrypt key derivation (v2 format). */
function deriveKeyV2(secret: string, salt: Buffer): Buffer {
  return crypto.scryptSync(secret, salt, 32);
}

function getEncryptionKey(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  const raw = env?.INVOICING_ENCRYPTION_KEY ?? process.env.INVOICING_ENCRYPTION_KEY;

  if (!raw) {
    throw new Error('[crypto] No encryption key available. Set INVOICING_ENCRYPTION_KEY.');
  }

  return raw;
}

/** Encrypt plaintext. Always produces v2 format (scrypt KDF). */
export function encrypt(plaintext: string): string {
  const secret = getEncryptionKey();
  const salt = crypto.randomBytes(SALT_BYTES);
  const key = deriveKeyV2(secret, salt);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv) as crypto.CipherGCM;

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `v2:${iv.toString('hex')}:${salt.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/** Decrypt a value. Handles both v2 (scrypt) and v1 (SHA-256) formats. */
export function decrypt(value: string): string {
  const secret = getEncryptionKey();

  if (value.startsWith('v2:')) {
    const parts = value.split(':');
    if (parts.length !== 5) {
      throw new Error('[crypto] Invalid v2 ciphertext format');
    }
    const [, ivHex, saltHex, authTagHex, ctHex] = parts;
    const salt = Buffer.from(saltHex, 'hex');
    const key = deriveKeyV2(secret, salt);
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const ct = Buffer.from(ctHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv) as crypto.DecipherGCM;
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }

  // v1 format (legacy): ivHex:authTagHex:ctHex
  const parts = value.split(':');
  if (parts.length !== 3) {
    throw new Error('[crypto] Invalid ciphertext format');
  }

  const [ivHex, authTagHex, ctHex] = parts;
  const key = deriveKeyV1(secret);
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ct = Buffer.from(ctHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv) as crypto.DecipherGCM;
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Match both v2 and v1 encrypted formats. */
const ENCRYPTED_PATTERN = /^(v2:)?[0-9a-f]+:[0-9a-f]+:[0-9a-f]+(:[0-9a-f]+)?$/i;

export function isEncrypted(value: string): boolean {
  return ENCRYPTED_PATTERN.test(value);
}

export function decryptIfNeeded(value: string): string {
  return isEncrypted(value) ? decrypt(value) : value;
}
