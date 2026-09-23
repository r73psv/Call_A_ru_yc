/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { S3Client, GetObjectCommand, PutObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { encrypt, decrypt } from '../store/crypto-store.js';
import { readStoreSync } from '../store/store.js';

// ─── Клиент S3 timeweb.cloud ───
function getTimewebS3Client(): { s3: S3Client; bucket: string; storeKey: string; keyPrefix: string } | null {
  let endpoint = process.env.S3_ENDPOINT;
  let accessKeyId = process.env.S3_ACCESS_KEY;
  let secretAccessKey = process.env.S3_SECRET_KEY;
  let bucket = process.env.S3_BUCKET_NAME;
  let region = process.env.S3_REGION || 'ru-1';
  let keyPrefix = process.env.S3_KEY_PREFIX || 'app/data/';

  try {
    const store = readStoreSync();
    const creds = store.config?.credentials;
    if (creds) {
      if (creds.s3Endpoint) endpoint = creds.s3Endpoint;
      if (creds.s3AccessKey) accessKeyId = creds.s3AccessKey;
      if (creds.s3SecretKey) secretAccessKey = creds.s3SecretKey;
      if (creds.s3BucketName) bucket = creds.s3BucketName;
      if (creds.s3Region) region = creds.s3Region;
      if (creds.s3KeyPrefix) keyPrefix = creds.s3KeyPrefix;
    }
  } catch (e) {
    // ignore
  }

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    return null;
  }

  const s3 = new S3Client({
    region,
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: true,
  });

  const storeKey = `${keyPrefix}data-store.enc`;

  return { s3, bucket, storeKey, keyPrefix };
}

let lastSyncedAt: string | null = null;
let lastSyncError: string | null = null;

// ─── Boot Hydration: загрузка при старте ───
export async function hydrateFromS3(): Promise<any> {
  const clientInfo = getTimewebS3Client();
  if (!clientInfo) {
    console.log('[S3] Переменные S3 timeweb.cloud не настроены. Hydration пропущен.');
    return null;
  }

  const { s3, bucket, storeKey, keyPrefix } = clientInfo;

  try {
    console.log(`[S3] Попытка загрузки зашифрованной базы из s3://${bucket}/${storeKey}...`);
    const res = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: storeKey })
    );
    const raw = await res.Body!.transformToString('utf-8');
    const payload = JSON.parse(raw);

    // Расшифровка AES-256-GCM
    const decrypted = decrypt(payload);
    const data = JSON.parse(decrypted);

    // Проверка наличия новых секций (для миграции)
    if (!data.consents) data.consents = [];
    if (!data.access_log) data.access_log = [];

    lastSyncedAt = new Date().toISOString();
    lastSyncError = null;

    console.log(
      `[S3] Hydration: загружено ${data.calls?.length || 0} звонков, ` +
      `${data.consents?.length || 0} согласий`
    );

    return data;
  } catch (err: any) {
    // Попытка загрузить старый формат (data-store.json) — для обратной совместимости
    const isNotFound = err.$metadata?.httpStatusCode === 404 || err.name === 'NoSuchKey' || err.Code === 'NoSuchKey';
    if (isNotFound) {
      console.log('[S3] Файл .enc не найден. Попытка загрузить старый формат...');

      try {
        const legacyRes = await s3.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: `${keyPrefix}data-store.json`,
          })
        );
        const legacyRaw = await legacyRes.Body!.transformToString('utf-8');
        const legacyData = JSON.parse(legacyRaw);

        // Миграция: добавляем недостающие секции
        if (!legacyData.consents) legacyData.consents = [];
        if (!legacyData.access_log) legacyData.access_log = [];

        lastSyncedAt = new Date().toISOString();
        lastSyncError = null;

        console.log(
          `[S3] Миграция: загружен старый формат, ` +
          `${legacyData.calls?.length || 0} звонков. ` +
          'Файл будет сохранён в новом формате .enc при первой синхронизации.'
        );

        return legacyData;
      } catch (legacyErr) {
        console.log('[S3] Старый формат также не найден. Старт с локальной/пустой базой.');
        return null;
      }
    }

    lastSyncError = err.message || String(err);
    console.error('[S3] Ошибка при Hydration из S3:', lastSyncError);
    return null;
  }
}

// ─── Auto-sync: отложенная выгрузка ───
let syncTimer: NodeJS.Timeout | null = null;

export function scheduleSyncToS3(getData: () => any): void {
  const clientInfo = getTimewebS3Client();
  if (!clientInfo) return;

  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncToS3(getData()).catch(err => {
      lastSyncError = err.message || String(err);
      console.error('[S3] Ошибка auto-sync:', err.message);
    });
  }, 2000);
}

export async function syncToS3(data: any): Promise<void> {
  const clientInfo = getTimewebS3Client();
  if (!clientInfo) {
    throw new Error('Конфигурация S3 timeweb.cloud не задана в .env');
  }

  const { s3, bucket, storeKey } = clientInfo;
  const json = JSON.stringify(data, null, 2);
  const payload = encrypt(json);

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: storeKey,
      Body: JSON.stringify(payload, null, 2),
      ContentType: 'application/octet-stream',
    })
  );

  lastSyncedAt = new Date().toISOString();
  lastSyncError = null;
  console.log(`[S3] Синхронизация завершена (${storeKey}):`, lastSyncedAt);
}

// ─── Ручная синхронизация ───
export async function manualSync(getData: () => any): Promise<{
  ok: boolean;
  synced_at: string;
  size_bytes: number;
}> {
  const clientInfo = getTimewebS3Client();
  if (!clientInfo) {
    throw new Error('S3 timeweb.cloud не настроен в .env');
  }

  const data = getData();
  const json = JSON.stringify(data, null, 2);
  const payload = encrypt(json);
  const payloadStr = JSON.stringify(payload, null, 2);

  await clientInfo.s3.send(
    new PutObjectCommand({
      Bucket: clientInfo.bucket,
      Key: clientInfo.storeKey,
      Body: payloadStr,
      ContentType: 'application/octet-stream',
    })
  );

  const sizeBytes = Buffer.byteLength(payloadStr, 'utf-8');
  lastSyncedAt = new Date().toISOString();
  lastSyncError = null;
  console.log('[S3] Ручная синхронизация завершена:', lastSyncedAt);

  return {
    ok: true,
    synced_at: lastSyncedAt,
    size_bytes: sizeBytes,
  };
}

// ─── Статус синхронизации для UI ───
export async function getSyncStatus(): Promise<{
  bucket: string;
  key: string;
  endpoint: string;
  connected: boolean;
  synced_at: string | null;
  error?: string | null;
}> {
  const clientInfo = getTimewebS3Client();
  const bucketName = process.env.S3_BUCKET_NAME || '—';
  const prefix = process.env.S3_KEY_PREFIX || 'app/data/';
  const keyName = `${prefix}data-store.enc`;
  const endpoint = process.env.S3_ENDPOINT || '';

  if (!clientInfo) {
    return {
      bucket: bucketName,
      key: keyName,
      endpoint,
      connected: false,
      synced_at: lastSyncedAt,
      error: 'Переменные S3 timeweb.cloud не заданы',
    };
  }

  try {
    await clientInfo.s3.send(new HeadBucketCommand({ Bucket: clientInfo.bucket }));
    return {
      bucket: clientInfo.bucket,
      key: clientInfo.storeKey,
      endpoint,
      connected: true,
      synced_at: lastSyncedAt,
      error: lastSyncError,
    };
  } catch (err: any) {
    return {
      bucket: clientInfo.bucket,
      key: clientInfo.storeKey,
      endpoint,
      connected: false,
      synced_at: lastSyncedAt,
      error: err.message || lastSyncError,
    };
  }
}
