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

export function parseKeyFromRawString(raw: string, explicitSaId?: string): AuthorizedKey | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();

  // A. JSON format
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.private_key && (parsed.service_account_id || explicitSaId)) {
        return {
          id: parsed.id || 'default-key',
          service_account_id: parsed.service_account_id || explicitSaId || '',
          private_key: parsed.private_key,
          public_key: parsed.public_key,
        };
      }
    } catch {}
  }

  // B. PEM format or text with Key ID
  if (trimmed.includes('BEGIN PRIVATE KEY') || trimmed.includes('BEGIN RSA PRIVATE KEY')) {
    const keyIdMatch = trimmed.match(/<([a-zA-Z0-9_-]+)>/) || trimmed.match(/id\s*[:=]\s*([a-zA-Z0-9_-]+)/i);
    const keyId = keyIdMatch ? keyIdMatch[1] : 'default-key';

    const privMatch = trimmed.match(/-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA )?PRIVATE KEY-----/);
    if (!privMatch) return null;

    // Normalize PEM formatting with proper 64-char lines
    const rawBody = privMatch[0]
      .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/, '')
      .replace(/-----END (?:RSA )?PRIVATE KEY-----/, '')
      .replace(/\s+/g, '');
    const cleanPem = `-----BEGIN PRIVATE KEY-----\n${rawBody.match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----`;

    const pubMatch = trimmed.match(/-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/);
    let cleanPub: string | undefined;
    if (pubMatch) {
      const pubBody = pubMatch[0]
        .replace(/-----BEGIN PUBLIC KEY-----/, '')
        .replace(/-----END PUBLIC KEY-----/, '')
        .replace(/\s+/g, '');
      cleanPub = `-----BEGIN PUBLIC KEY-----\n${pubBody.match(/.{1,64}/g)?.join('\n')}\n-----END PUBLIC KEY-----`;
    }

    const saIdMatch = trimmed.match(/SA(?:_|\s+)?ID\s*[:=<\s]+([a-zA-Z0-9_-]+)/i) ||
      trimmed.match(/service[_-]?account[_-]?id\s*[:=<\s]+([a-zA-Z0-9_-]+)/i);
    const saId = explicitSaId || (saIdMatch ? saIdMatch[1] : '') || process.env.YC_SERVICE_ACCOUNT_ID || '';

    return {
      id: keyId,
      service_account_id: saId,
      private_key: cleanPem,
      public_key: cleanPub,
    };
  }

  return null;
}

export function loadAuthorizedKey(): AuthorizedKey | null {
  if (authorizedKey && authorizedKey.private_key && authorizedKey.service_account_id) {
    return authorizedKey;
  }

  let storeSaId: string | undefined;
  try {
    const store = readStoreSync();
    storeSaId = store.config?.credentials?.yandexServiceAccountId;
  } catch {}

  // 1. Check custom file path or inline string from store credentials
  try {
    const store = readStoreSync();
    const customFilePath = store.config?.credentials?.yandexServiceAccountKeyFile;
    if (customFilePath) {
      if (customFilePath.length > 250 || customFilePath.includes('PRIVATE KEY') || customFilePath.includes('{')) {
        const parsed = parseKeyFromRawString(customFilePath, storeSaId);
        if (parsed && parsed.service_account_id) {
          authorizedKey = parsed;
          return authorizedKey;
        }
      } else if (fs.existsSync(customFilePath)) {
        try {
          const raw = fs.readFileSync(customFilePath, 'utf-8');
          const parsed = parseKeyFromRawString(raw, storeSaId);
          if (parsed) {
            authorizedKey = parsed;
            console.log(`[Yandex Auth] Авторизованный ключ успешно загружен из настроек пути: ${customFilePath}`);
            return authorizedKey;
          }
        } catch (errCustom: any) {
          console.warn(`[Yandex Auth] Ошибка парсинга файла ключа из настроек ${customFilePath}:`, errCustom.message);
        }
      }
    }
  } catch (e) {
    // ignore
  }

  // 2. Check store credentials JSON string from admin panel
  try {
    const store = readStoreSync();
    if (store.config?.credentials?.yandexServiceAccountKeyJson) {
      const parsed = parseKeyFromRawString(store.config.credentials.yandexServiceAccountKeyJson, storeSaId);
      if (parsed) {
        authorizedKey = parsed;
        return authorizedKey;
      }
    }
  } catch (e) {
    // ignore
  }

  // 3. Check environment file path or default container keys path
  const envVal = process.env.YC_SERVICE_ACCOUNT_KEY_FILE;
  if (envVal) {
    // If env variable is raw key text rather than a real path:
    if (envVal.length > 250 || envVal.includes('PRIVATE KEY') || envVal.includes('{')) {
      const parsed = parseKeyFromRawString(envVal, storeSaId);
      if (parsed && parsed.service_account_id) {
        authorizedKey = parsed;
        return authorizedKey;
      }
    }
  }

  const candidatePaths = [
    envVal && envVal.length < 250 && !envVal.includes('\n') ? envVal : null,
    '/app/keys/authorized_key.json',
    path.join(process.cwd(), 'keys', 'authorized_key.json'),
    path.join(process.cwd(), 'authorized_key.json'),
  ].filter(Boolean) as string[];

  for (const keyPath of candidatePaths) {
    if (fs.existsSync(keyPath)) {
      try {
        const raw = fs.readFileSync(keyPath, 'utf-8');
        const parsed = parseKeyFromRawString(raw, storeSaId);
        if (parsed) {
          authorizedKey = parsed;
          console.log(`[Yandex Auth] Авторизованный ключ успешно загружен из ${keyPath}`);
          return authorizedKey;
        }
      } catch (e: any) {
        console.warn(`[Yandex Auth] Ошибка парсинга файла ключа ${keyPath}:`, e.message);
      }
    }
  }

  // 4. Check inline env variable if provided
  if (process.env.YC_SERVICE_ACCOUNT_KEY_JSON) {
    try {
      const parsed = parseKeyFromRawString(process.env.YC_SERVICE_ACCOUNT_KEY_JSON, storeSaId);
      if (parsed) {
        authorizedKey = parsed;
        return authorizedKey;
      }
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

    const key = loadAuthorizedKey();
    if (key && (key.service_account_id || key.id)) {
      return {
        configured: true,
        serviceAccountId: key.service_account_id,
        keyId: key.id,
        source: 'authorized_key',
        filePath: '/app/keys/authorized_key.json',
      };
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

export async function testYandexSpeechKit(
  apiKeyOverride?: string,
  folderIdOverride?: string
): Promise<{ success: boolean; message: string; authType: string; folderId?: string }> {
  const apiKey = apiKeyOverride || getYandexApiKey();
  const folderId = folderIdOverride || getYandexFolderId();

  let authHeader = '';
  let authType = 'api_key';

  if (apiKey) {
    authHeader = `Api-Key ${apiKey.trim()}`;
    authType = 'api_key';
  } else {
    try {
      const iamToken = await getIamToken();
      authHeader = `Bearer ${iamToken}`;
      authType = 'iam_token';
    } catch (e: any) {
      throw new Error(`Ошибка генерации IAM-токена: ${e.message}`);
    }
  }

  // Make a real test request to SpeechKit API with an Opus header
  try {
    const query = new URLSearchParams({
      lang: 'ru-RU',
      topic: 'general',
      format: 'oggopus',
    });
    if (folderId) {
      query.set('folderId', folderId.trim());
    }

    const testAudio = Buffer.alloc(64);
    await axios.post(
      `https://stt.api.cloud.yandex.net/speech/v1/stt:recognize?${query.toString()}`,
      testAudio,
      {
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/octet-stream',
        },
        timeout: 10000,
      }
    );

    return {
      success: true,
      message: authType === 'api_key'
        ? 'Постоянный API-ключ Yandex Cloud успешно проверен и подтверждён сервером SpeechKit!'
        : 'IAM-токен сервисного аккаунта успешно подтверждён сервером SpeechKit!',
      authType,
      folderId: folderId || '(не указан)',
    };
  } catch (err: any) {
    if (err.response?.status === 401 || err.response?.status === 403) {
      let detail = err.response?.data?.error_message || err.response?.data?.message || 'Неверный ключ или отсутствует доступ к SpeechKit';
      if (apiKey && apiKey.startsWith('aje')) {
        detail = `Внимание: введен идентификатор ключа (${apiKey}), а не секретный API-ключ. Секретный API-ключ Yandex Cloud начинается на AQVN... и отображается в окне создания ключа один раз. Скопируйте секретный ключ или загрузите authorized_key.json.`;
      }
      throw new Error(`Ошибка авторизации Yandex Cloud (${err.response.status}): ${detail}`);
    }
    // Any 400 Bad Request regarding audio data means authentication SUCCEEDED (it passed auth check)!
    if (err.response?.status === 400) {
      return {
        success: true,
        message: authType === 'api_key'
          ? 'Постоянный API-ключ Yandex Cloud проверен и активен на сервере SpeechKit!'
          : 'IAM-токен сервисного аккаунта проверен и активен на сервере SpeechKit!',
        authType,
        folderId: folderId || '(не указан)',
      };
    }
    throw new Error(err.response?.data?.message || err.message);
  }
}

