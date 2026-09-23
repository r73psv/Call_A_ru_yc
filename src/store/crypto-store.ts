/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

// 256 bits = 32 bytes = 64 hex characters
let customEncryptionKey: string | null = null;
let cachedKey: Buffer | null = null;

export function setStoreEncryptionKey(key: string | null): void {
  customEncryptionKey = key ? key.trim() : null;
  cachedKey = null;
}

export function invalidateEncryptionKeyCache(): void {
  cachedKey = null;
}

export function isStoreEncryptionKeyConfigured(): boolean {
  const hexKey = customEncryptionKey || process.env.STORE_ENCRYPTION_KEY;
  return Boolean(hexKey && hexKey.length === 64 && /^[0-9a-fA-F]+$/.test(hexKey));
}

export function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const hexKey = customEncryptionKey || process.env.STORE_ENCRYPTION_KEY;
  if (hexKey && hexKey.length === 64 && /^[0-9a-fA-F]+$/.test(hexKey)) {
    cachedKey = Buffer.from(hexKey, 'hex');
    return cachedKey;
  }
  if (hexKey && hexKey.length >= 32) {
    cachedKey = crypto.createHash('sha256').update(hexKey).digest();
    return cachedKey;
  }

  // Fallback persistent key derivation if env var is missing or placeholder
  const fallbackSeed = process.env.ENCRYPTION_SECRET || 'lik28-default-fallback-encryption-salt-2026';
  cachedKey = crypto.createHash('sha256').update(fallbackSeed).digest();
  console.log('[CryptoStore] Используется резервный ключ шифрования (SHA-256 seed)');
  return cachedKey;
}

export function encrypt(data: string): { encrypted: string; iv: string; tag: string } {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

export function decrypt(payload: { encrypted: string; iv: string; tag: string }): string {
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(payload.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.encrypted, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}
