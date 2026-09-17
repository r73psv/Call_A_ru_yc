/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { encrypt, decrypt } from './crypto-store.js';
import { ConsentRecord } from '../types.js';

const CONSENT_PATH = process.env.CONSENT_PATH || path.join(process.cwd(), 'data', 'consents.enc');

export interface ConsentStoreData {
  consents: ConsentRecord[];
}

export async function readConsentStore(): Promise<ConsentStoreData> {
  try {
    const dir = path.dirname(CONSENT_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (!existsSync(CONSENT_PATH)) {
      const initial: ConsentStoreData = { consents: [] };
      await writeConsentStore(initial);
      return initial;
    }

    const raw = await fs.readFile(CONSENT_PATH, 'utf-8');
    // Try to decrypt payload
    try {
      const payload = JSON.parse(raw);
      if (payload && payload.encrypted && payload.iv && payload.tag) {
        const decrypted = decrypt(payload);
        return JSON.parse(decrypted);
      }
      // If unencrypted JSON (legacy)
      if (payload && Array.isArray(payload.consents)) {
        await writeConsentStore(payload); // Auto-encrypt
        return payload;
      }
    } catch (parseErr) {
      console.warn('[ConsentStore] Ошибка расшифровки файла согласий, создаем новый реестр:', parseErr);
    }
    return { consents: [] };
  } catch (err: any) {
    console.error('[ConsentStore] Ошибка чтения реестра согласий:', err.message);
    return { consents: [] };
  }
}

import * as fsSync from 'fs';

export function readConsentStoreSync(): ConsentStoreData {
  try {
    const dir = path.dirname(CONSENT_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (!existsSync(CONSENT_PATH)) {
      return { consents: [] };
    }

    const raw = fsSync.readFileSync(CONSENT_PATH, 'utf-8');
    try {
      const payload = JSON.parse(raw);
      if (payload && payload.encrypted && payload.iv && payload.tag) {
        const decrypted = decrypt(payload);
        return JSON.parse(decrypted);
      }
      if (payload && Array.isArray(payload.consents)) {
        return payload;
      }
    } catch (parseErr) {
      console.warn('[ConsentStoreSync] Ошибка расшифровки файла согласий:', parseErr);
    }
    return { consents: [] };
  } catch (err: any) {
    console.error('[ConsentStoreSync] Ошибка чтения реестра согласий:', err.message);
    return { consents: [] };
  }
}

export async function writeConsentStore(data: ConsentStoreData): Promise<void> {
  try {
    const dir = path.dirname(CONSENT_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const json = JSON.stringify(data, null, 2);
    const payload = encrypt(json);
    await fs.writeFile(CONSENT_PATH, JSON.stringify(payload, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[ConsentStore] Ошибка записи реестра согласий:', err.message);
    throw err;
  }
}
