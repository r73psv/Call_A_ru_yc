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
const CONSENT_BACKUP_PATH = path.join(path.dirname(CONSENT_PATH), 'consents.backup.json');

export interface ConsentStoreData {
  consents: ConsentRecord[];
}

let memConsentsCache: ConsentStoreData | null = null;
let writeQueue: Promise<void> = Promise.resolve();

export function invalidateConsentStoreCache(): void {
  memConsentsCache = null;
}

export function setConsentStoreDirect(data: ConsentStoreData): void {
  memConsentsCache = {
    consents: Array.isArray(data.consents) ? [...data.consents] : []
  };
}

export async function readConsentStore(): Promise<ConsentStoreData> {
  if (memConsentsCache) {
    return { consents: [...memConsentsCache.consents] };
  }

  try {
    const dir = path.dirname(CONSENT_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (existsSync(CONSENT_PATH)) {
      const raw = await fs.readFile(CONSENT_PATH, 'utf-8');
      try {
        const payload = JSON.parse(raw);
        if (payload && payload.encrypted && payload.iv && payload.tag) {
          const decrypted = decrypt(payload);
          const parsed: ConsentStoreData = JSON.parse(decrypted);
          memConsentsCache = { consents: Array.isArray(parsed.consents) ? parsed.consents : [] };
          return { consents: [...memConsentsCache.consents] };
        }
        if (payload && Array.isArray(payload.consents)) {
          memConsentsCache = { consents: payload.consents };
          await writeConsentStore(payload);
          return { consents: [...memConsentsCache.consents] };
        }
      } catch (parseErr) {
        console.warn('[ConsentStore] Ошибка расшифровки файла согласий, проверяем резервную копию:', parseErr);
      }
    }

    // Try reading unencrypted backup mirror
    if (existsSync(CONSENT_BACKUP_PATH)) {
      try {
        const bakRaw = await fs.readFile(CONSENT_BACKUP_PATH, 'utf-8');
        const bakParsed = JSON.parse(bakRaw);
        if (bakParsed && Array.isArray(bakParsed.consents)) {
          console.log(`[ConsentStore] Восстановлено ${bakParsed.consents.length} согласий из резервной копии.`);
          memConsentsCache = { consents: bakParsed.consents };
          await writeConsentStore(memConsentsCache);
          return { consents: [...memConsentsCache.consents] };
        }
      } catch (bakErr) {
        console.warn('[ConsentStore] Ошибка чтения резервной копии согласий:', bakErr);
      }
    }

    const initial: ConsentStoreData = { consents: [] };
    memConsentsCache = initial;
    await writeConsentStore(initial);
    return { consents: [] };
  } catch (err: any) {
    console.error('[ConsentStore] Ошибка чтения реестра согласий:', err.message);
    return { consents: [] };
  }
}

import * as fsSync from 'fs';

export function readConsentStoreSync(): ConsentStoreData {
  if (memConsentsCache) {
    return { consents: [...memConsentsCache.consents] };
  }

  try {
    const dir = path.dirname(CONSENT_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (existsSync(CONSENT_PATH)) {
      const raw = fsSync.readFileSync(CONSENT_PATH, 'utf-8');
      try {
        const payload = JSON.parse(raw);
        if (payload && payload.encrypted && payload.iv && payload.tag) {
          const decrypted = decrypt(payload);
          const parsed: ConsentStoreData = JSON.parse(decrypted);
          memConsentsCache = { consents: Array.isArray(parsed.consents) ? parsed.consents : [] };
          return { consents: [...memConsentsCache.consents] };
        }
        if (payload && Array.isArray(payload.consents)) {
          memConsentsCache = { consents: payload.consents };
          return { consents: [...memConsentsCache.consents] };
        }
      } catch (parseErr) {
        console.warn('[ConsentStoreSync] Ошибка расшифровки файла согласий:', parseErr);
      }
    }

    // Try reading backup mirror synchronously
    if (existsSync(CONSENT_BACKUP_PATH)) {
      try {
        const bakRaw = fsSync.readFileSync(CONSENT_BACKUP_PATH, 'utf-8');
        const bakParsed = JSON.parse(bakRaw);
        if (bakParsed && Array.isArray(bakParsed.consents)) {
          memConsentsCache = { consents: bakParsed.consents };
          return { consents: [...memConsentsCache.consents] };
        }
      } catch {}
    }

    memConsentsCache = { consents: [] };
    return { consents: [] };
  } catch (err: any) {
    console.error('[ConsentStoreSync] Ошибка чтения реестра согласий:', err.message);
    return { consents: [] };
  }
}

export async function writeConsentStore(data: ConsentStoreData): Promise<void> {
  // 1. Update memory cache immediately so concurrent calls see latest state
  memConsentsCache = {
    consents: Array.isArray(data.consents) ? [...data.consents] : []
  };

  // 2. Queue async disk write safely without letting single failure break the queue
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    try {
      const dir = path.dirname(CONSENT_PATH);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const storeToSave = memConsentsCache || data;
      const json = JSON.stringify(storeToSave, null, 2);
      const payload = encrypt(json);
      
      // Atomic write to encrypted file
      const tmpEnc = `${CONSENT_PATH}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await fs.writeFile(tmpEnc, JSON.stringify(payload, null, 2), 'utf-8');
      await fs.rename(tmpEnc, CONSENT_PATH);

      // Write backup unencrypted mirror for safe emergency recovery
      try {
        const tmpBak = `${CONSENT_BACKUP_PATH}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        await fs.writeFile(tmpBak, json, 'utf-8');
        await fs.rename(tmpBak, CONSENT_BACKUP_PATH);
      } catch (bakWriteErr: any) {
        console.warn('[ConsentStore] Предупреждение: не удалось обновить backup mirror согласий:', bakWriteErr.message);
      }
    } catch (err: any) {
      console.error('[ConsentStore] Ошибка записи реестра согласий:', err.message);
    }
  });

  return writeQueue;
}
