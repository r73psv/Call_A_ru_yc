/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import axios from 'axios';
import https from 'https';
import { randomUUID } from 'crypto';
import { readStoreSync } from '../store/store.js';

let gigaTokenCache: { token: string; expiresAt: number } | null = null;

// GigaChat API uses Russian state CA certificates (Минцифры РФ).
// We set rejectUnauthorized to false to allow smooth TLS handshake across container environments.
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

export function getEffectiveGigaChatKey(): string {
  try {
    const store = readStoreSync();
    if (store.config?.credentials?.gigachatAuthKey) {
      return store.config.credentials.gigachatAuthKey;
    }
  } catch (e) {
    // Ignore store read issues and fallback to env
  }
  return process.env.GIGACHAT_AUTH_KEY || '';
}

export function getEffectiveGigaChatScope(): string {
  try {
    const store = readStoreSync();
    if (store.config?.credentials?.gigachatScope) {
      return store.config.credentials.gigachatScope;
    }
  } catch (e) {
    // Ignore
  }
  return process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS';
}

export async function getGigaChatToken(): Promise<string> {
  const now = Date.now();
  if (gigaTokenCache && gigaTokenCache.expiresAt - now > 60000) {
    return gigaTokenCache.token;
  }

  const authKey = getEffectiveGigaChatKey();
  if (!authKey) {
    throw new Error('GIGACHAT_AUTH_KEY не задан в настройках админ-панели или .env');
  }

  const formattedAuth = authKey.startsWith('Basic ') || authKey.startsWith('Bearer ')
    ? authKey
    : `Basic ${authKey}`;

  const scope = getEffectiveGigaChatScope();
  const oauthUrl = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';

  const res = await axios.post(
    oauthUrl,
    `scope=${encodeURIComponent(scope)}`,
    {
      headers: {
        Authorization: formattedAuth,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        RqUID: randomUUID(),
      },
      httpsAgent,
      timeout: 20000,
    }
  );

  if (!res.data || !res.data.access_token) {
    throw new Error('GigaChat не вернул access_token при авторизации');
  }

  const expiresInMs = (res.data.expires_at ? res.data.expires_at - now : 1800000);
  gigaTokenCache = {
    token: res.data.access_token,
    expiresAt: now + expiresInMs,
  };

  console.log('[GigaChat Auth] Новый токен успешно получен и сохранён в кэш');
  return gigaTokenCache.token;
}

export function invalidateGigaChatTokenCache(): void {
  gigaTokenCache = null;
  console.log('[GigaChat Auth] Кэш токена авторизации сброшен');
}

export function isGigaChatConfigured(): boolean {
  const key = getEffectiveGigaChatKey();
  return !!key && key !== '<ключ-авторизации-GigaChat>';
}
