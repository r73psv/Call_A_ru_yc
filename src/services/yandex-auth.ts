/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import path from 'path';
import axios from 'axios';
import jose from 'node-jose';
import { readStoreSync } from '../store/store.js';

interface IamTokenCache {
  token: string;
  expiresAt: number;
}

interface AuthorizedKey {
  id: string;
  service_account_id: string;
  private_key: string;
  public_key?: string;
}

let iamTokenCache: IamTokenCache | null = null;
let authorizedKey: AuthorizedKey | null = null;

export function invalidateAuthorizedKeyCache(): void {
  authorizedKey = null;
  iamTokenCache = null;
}

export function loadAuthorizedKey(): AuthorizedKey | null {
  if (authorizedKey) return authorizedKey;

  // 1. Check custom file path from admin panel store credentials
  try {
    const store = readStoreSync();
    const customFilePath = store.config?.credentials?.yandexServiceAccountKeyFile;
    if (customFilePath && fs.existsSync(customFilePath)) {
      try {
        const raw = fs.readFileSync(customFilePath, 'utf-8');
        authorizedKey = JSON.parse(raw);
        console.log(`[Yandex Auth] Авторизованный ключ успешно загружен из настроек пути: ${customFilePath}`);
        return authorizedKey;
      } catch (errCustom: any) {
        console.warn(`[Yandex Auth] Ошибка парсинга файла ключа из настроек ${customFilePath}:`, errCustom.message);
      }
    }
  } catch (e) {
    // ignore
  }

  // 2. Check store credentials JSON string from admin panel
  try {
    const store = readStoreSync();
    if (store.config?.credentials?.yandexServiceAccountKeyJson) {
      authorizedKey = JSON.parse(store.config.credentials.yandexServiceAccountKeyJson);
      return authorizedKey;
    }
  } catch (e) {
    // ignore
  }

  // 3. Check environment file path or default container keys path
  const candidatePaths = [
    process.env.YC_SERVICE_ACCOUNT_KEY_FILE,
    '/app/keys/authorized_key.json',
    path.join(process.cwd(), 'keys', 'authorized_key.json'),
    path.join(process.cwd(), 'authorized_key.json'),
  ].filter(Boolean) as string[];

  for (const keyPath of candidatePaths) {
    if (fs.existsSync(keyPath)) {
      try {
        const raw = fs.readFileSync(keyPath, 'utf-8');
        authorizedKey = JSON.parse(raw);
        console.log(`[Yandex Auth] Авторизованный ключ успешно загружен из ${keyPath}`);
        return authorizedKey;
      } catch (e: any) {
        console.warn(`[Yandex Auth] Ошибка парсинга файла ключа ${keyPath}:`, e.message);
      }
    }
  }

  // 4. Check inline env variable if provided
  if (process.env.YC_SERVICE_ACCOUNT_KEY_JSON) {
    try {
      authorizedKey = JSON.parse(process.env.YC_SERVICE_ACCOUNT_KEY_JSON);
      return authorizedKey;
    } catch (e: any) {
      console.warn('[Yandex Auth] Ошибка парсинга YC_SERVICE_ACCOUNT_KEY_JSON:', e.message);
    }
  }

  return null;
}

export function getAuthorizedKeyInfo(): {
  configured: boolean;
  serviceAccountId?: string;
  keyId?: string;
  source?: string;
  filePath?: string;
  fileSizeBytes?: number;
  lastModified?: string;
} {
  try {
    const store = readStoreSync();
    const customFilePath = store.config?.credentials?.yandexServiceAccountKeyFile;
    const candidatePaths = [
      customFilePath,
      process.env.YC_SERVICE_ACCOUNT_KEY_FILE,
      '/app/keys/authorized_key.json',
      path.join(process.cwd(), 'keys', 'authorized_key.json'),
      path.join(process.cwd(), 'authorized_key.json'),
    ].filter(Boolean) as string[];

    for (const keyPath of candidatePaths) {
      if (fs.existsSync(keyPath)) {
        try {
          const stats = fs.statSync(keyPath);
          const raw = fs.readFileSync(keyPath, 'utf-8');
          const parsed = JSON.parse(raw);
          if (parsed && (parsed.service_account_id || parsed.id)) {
            return {
              configured: true,
              serviceAccountId: parsed.service_account_id,
              keyId: parsed.id,
              source: 'file',
              filePath: keyPath,
              fileSizeBytes: stats.size,
              lastModified: stats.mtime.toISOString(),
            };
          }
        } catch {}
      }
    }

    if (store.config?.credentials?.yandexServiceAccountKeyJson) {
      try {
        const parsed = JSON.parse(store.config.credentials.yandexServiceAccountKeyJson);
        return {
          configured: true,
          serviceAccountId: parsed.service_account_id,
          keyId: parsed.id,
          source: 'store_json',
        };
      } catch {}
    }

    if (process.env.YC_SERVICE_ACCOUNT_KEY_JSON) {
      try {
        const parsed = JSON.parse(process.env.YC_SERVICE_ACCOUNT_KEY_JSON);
        return {
          configured: true,
          serviceAccountId: parsed.service_account_id,
          keyId: parsed.id,
          source: 'env_json',
        };
      } catch {}
    }
  } catch {}

  return { configured: false };
}

export async function createJwt(): Promise<string> {
  const key = loadAuthorizedKey();
  if (!key) {
    throw new Error('Авторизованный ключ Yandex Cloud не найден (YC_SERVICE_ACCOUNT_KEY_FILE)');
  }

  const now = Math.floor(Date.now() / 1000);

  const payload = {
    iss: key.service_account_id,
    iat: now,
    exp: now + 3600,
    aud: 'https://iam.api.cloud.yandex.net/iam/v1/tokens',
  };

  const jwk = await jose.JWK.asKey(key.private_key, 'pem', {
    kid: key.id,
    alg: 'PS256',
  });

  const signed = await jose.JWS.createSign({ format: 'compact' }, jwk)
    .update(JSON.stringify(payload))
    .final();

  return signed.toString();
}

export async function getIamToken(): Promise<string> {
  const now = Date.now();

  if (iamTokenCache && iamTokenCache.expiresAt - now > 3600000) {
    return iamTokenCache.token;
  }

  const key = loadAuthorizedKey();
  if (!key) {
    // If no key is configured on server, throw informative error
    throw new Error('YC_SERVICE_ACCOUNT_KEY_FILE не задан или файл отсутствует на сервере');
  }

  const jwt = await createJwt();

  const res = await axios.post(
    'https://iam.api.cloud.yandex.net/iam/v1/tokens',
    { jwt },
    { timeout: 15000 }
  );

  const expiresAt = new Date(res.data.expiresAt).getTime();
  iamTokenCache = {
    token: res.data.iamToken,
    expiresAt,
  };

  console.log('[Yandex Auth] Получен новый IAM-токен, истекает:', res.data.expiresAt);
  return iamTokenCache.token;
}

export function getYandexApiKey(): string | null {
  try {
    const store = readStoreSync();
    if (store.config?.credentials?.yandexApiKey) {
      return store.config.credentials.yandexApiKey;
    }
  } catch (e) {}
  return process.env.YC_API_KEY || null;
}

export function getYandexFolderId(): string | null {
  try {
    const store = readStoreSync();
    if (store.config?.credentials?.yandexFolderId) {
      return store.config.credentials.yandexFolderId;
    }
  } catch (e) {}
  return process.env.YC_FOLDER_ID || null;
}

export async function getYandexAuthHeader(): Promise<string> {
  const apiKey = getYandexApiKey();
  if (apiKey) {
    return `Api-Key ${apiKey}`;
  }
  const iamToken = await getIamToken();
  return `Bearer ${iamToken}`;
}

export function isYandexAuthConfigured(): boolean {
  if (getYandexApiKey()) return true;
  return !!loadAuthorizedKey();
}
