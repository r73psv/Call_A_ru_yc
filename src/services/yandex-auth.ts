/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import path from 'path';
import axios from 'axios';
import jose from 'node-jose';

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

export function loadAuthorizedKey(): AuthorizedKey | null {
  if (authorizedKey) return authorizedKey;

  const keyPath = process.env.YC_SERVICE_ACCOUNT_KEY_FILE || path.join(process.cwd(), 'keys', 'authorized_key.json');
  
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

  // Check inline env variable if provided
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

export function isYandexAuthConfigured(): boolean {
  return !!loadAuthorizedKey();
}
