/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const ALGORITHM = 'aes-256-gcm';

// 256 bits = 32 bytes = 64 hex characters
let customEncryptionKey: string | null = null;
let cachedKey: Buffer | null = null;

function getKeyFilePath(): string {
  if (process.env.DATA_PATH_ENC) {
    return path.join(path.dirname(process.env.DATA_PATH_ENC), '.encryption-key');
  }
  if (process.env.DATA_PATH) {
    return path.join(path.dirname(process.env.DATA_PATH), '.encryption-key');
  }
  return path.join(process.cwd(), 'data', '.encryption-key');
}

export function setStoreEncryptionKey(key: string | null): void {
  customEncryptionKey = key ? key.trim() : null;
  cachedKey = null;

  // Persist to disk in mounted volume so redeploys don't lose the key
  if (customEncryptionKey) {
    try {
      const keyFile = getKeyFilePath();
      const dir = path.dirname(keyFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(keyFile, customEncryptionKey, { encoding: 'utf-8', mode: 0o600 });
      console.log('[CryptoStore] Ключ шифрования сохранен в постоянный файл:', keyFile);
    } catch (e: any) {
      console.warn('[CryptoStore] Не удалось сохранить .encryption-key на диск:', e.message);
    }
  }
}

export function invalidateEncryptionKeyCache(): void {
  cachedKey = null;
}

export function isStoreEncryptionKeyConfigured(): boolean {
  const hexKey = getActiveRawKey();
  return Boolean(hexKey && hexKey.length === 64 && /^[0-9a-fA-F]+$/.test(hexKey));
}

function getActiveRawKey(): string | null {
  if (customEncryptionKey) return customEncryptionKey;
  if (process.env.STORE_ENCRYPTION_KEY && process.env.STORE_ENCRYPTION_KEY.trim()) {
    return process.env.STORE_ENCRYPTION_KEY.trim();
  }

  // Check persistent file on mounted volume
  try {
    const keyFile = getKeyFilePath();
    if (fs.existsSync(keyFile)) {
      const fileKey = fs.readFileSync(keyFile, 'utf-8').trim();
      if (fileKey) {
        customEncryptionKey = fileKey;
        return fileKey;
      }
    }
  } catch (e) {
    // ignore
  }

  return null;
}

export function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;

  const hexKey = getActiveRawKey();
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

  // Persist fallback seed to key file if volume exists so it never changes
  try {
    const keyFile = getKeyFilePath();
    const dir = path.dirname(keyFile);
    if (fs.existsSync(dir) && !fs.existsSync(keyFile)) {
      fs.writeFileSync(keyFile, fallbackSeed, { encoding: 'utf-8', mode: 0o600 });
    }
  } catch {
    // ignore
  }

  console.log('[CryptoStore] Используется резервный ключ шифрования (SHA-256 seed)');
  return cachedKey;
}

export function getFallbackKey(): Buffer {
  const fallbackSeed = process.env.ENCRYPTION_SECRET || 'lik28-default-fallback-encryption-salt-2026';
  return crypto.createHash('sha256').update(fallbackSeed).digest();
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
  const primaryKey = getEncryptionKey();

  // Attempt 1: with primary key
  try {
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      primaryKey,
      Buffer.from(payload.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payload.encrypted, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch (err: any) {
    // Attempt 2: with fallback salt key
    const fallbackKey = getFallbackKey();
    if (!primaryKey.equals(fallbackKey)) {
      try {
        const fallbackDecipher = crypto.createDecipheriv(
          ALGORITHM,
          fallbackKey,
          Buffer.from(payload.iv, 'base64')
        );
        fallbackDecipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
        const decrypted = Buffer.concat([
          fallbackDecipher.update(Buffer.from(payload.encrypted, 'base64')),
          fallbackDecipher.final(),
        ]);
        console.warn('[CryptoStore] База данных успешно расшифрована резервным salt-ключом');
        return decrypted.toString('utf8');
      } catch (fallbackErr) {
        // Both failed
      }
    }
    throw err;
  }
}
