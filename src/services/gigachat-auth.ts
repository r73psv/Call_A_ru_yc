/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import axios from 'axios';
import https from 'https';

let gigaTokenCache: { token: string; expiresAt: number } | null = null;

// GigaChat API uses Russian state CA certificates (Минцифры РФ).
// We set rejectUnauthorized to false to allow smooth TLS handshake across container environments.
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

export async function getGigaChatToken(): Promise<string> {
  const now = Date.now();
  if (gigaTokenCache && gigaTokenCache.expiresAt - now > 60000) {
    return gigaTokenCache.token;
  }

  const authKey = process.env.GIGACHAT_AUTH_KEY;
  if (!authKey) {
    throw new Error('GIGACHAT_AUTH_KEY не задан в .env');
  }

  const formattedAuth = authKey.startsWith('Basic ') || authKey.startsWith('Bearer ')
    ? authKey
    : `Basic ${authKey}`;

  const res = await axios.post(
    'https://ngfg.services.gigachat-api.ru/api/v1/oauth',
    'scope=GIGACHAT_API_PERS',
    {
      headers: {
        Authorization: formattedAuth,
        'Content-Type': 'application/x-www-form-urlencoded',
        RqUID: `lik28-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
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
  return !!process.env.GIGACHAT_AUTH_KEY && process.env.GIGACHAT_AUTH_KEY !== '<ключ-авторизации-GigaChat>';
}
