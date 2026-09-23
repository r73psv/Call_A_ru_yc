/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { readStoreSync } from '../store/store.js';

export interface YandexStorageConfig {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
  region: string;
}

export function getYandexStorageConfig(): YandexStorageConfig | null {
  let accessKeyId = process.env.YC_STORAGE_ACCESS_KEY || process.env.YC_S3_KEY_ID;
  let secretAccessKey = process.env.YC_STORAGE_SECRET_KEY || process.env.YC_S3_SECRET_KEY;
  let bucket = process.env.YC_STORAGE_BUCKET;
  let endpoint = process.env.YC_STORAGE_ENDPOINT || 'https://storage.yandexcloud.net';
  let region = process.env.YC_STORAGE_REGION || 'ru-central1';

  try {
    const store = readStoreSync();
    const creds = store.config?.credentials;
    if (creds) {
      if (creds.yandexStorageAccessKey) accessKeyId = creds.yandexStorageAccessKey;
      if (creds.yandexStorageSecretKey) secretAccessKey = creds.yandexStorageSecretKey;
      if (creds.yandexStorageBucket) bucket = creds.yandexStorageBucket;
      if (creds.yandexStorageEndpoint) endpoint = creds.yandexStorageEndpoint;
      if (creds.yandexStorageRegion) region = creds.yandexStorageRegion;
    }
  } catch (e) {
    // ignore
  }

  if (!accessKeyId || !secretAccessKey || !bucket) {
    return null;
  }

  return {
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint,
    region,
  };
}

export function getYandexStorageBucket(): string | null {
  const cfg = getYandexStorageConfig();
  return cfg?.bucket || process.env.YC_STORAGE_BUCKET || null;
}

export function getYandexStorageClient(): { s3: S3Client; bucket: string } | null {
  const cfg = getYandexStorageConfig();
  if (!cfg) return null;

  const s3 = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
    forcePathStyle: true,
  });

  return { s3, bucket: cfg.bucket };
}

export async function uploadToObjectStorage(buffer: Buffer, key: string): Promise<void> {
  const clientInfo = getYandexStorageClient();
  if (!clientInfo) {
    throw new Error('Учетные данные Yandex Object Storage (Имя бакета, Access Key ID, Secret Key) не настроены');
  }

  const { s3, bucket } = clientInfo;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: 'audio/mpeg',
    })
  );
  console.log(`[Yandex Storage] Аудиофайл ${key} успешно загружен в s3://${bucket}`);
}

export async function deleteFromObjectStorage(key: string): Promise<void> {
  const clientInfo = getYandexStorageClient();
  if (!clientInfo) return;

  const { s3, bucket } = clientInfo;

  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
    console.log(`[Yandex Storage] Временный аудиофайл ${key} удалён после распознавания`);
  } catch (err: any) {
    console.warn(`[Yandex Storage] Ошибка удаления файла ${key}:`, err.message);
  }
}

export async function testYandexStorageBucket(params?: Partial<YandexStorageConfig>): Promise<{ success: boolean; message: string }> {
  const cfg = getYandexStorageConfig();
  const endpoint = params?.endpoint || cfg?.endpoint || 'https://storage.yandexcloud.net';
  const region = params?.region || cfg?.region || 'ru-central1';
  const accessKeyId = params?.accessKeyId || cfg?.accessKeyId;
  const secretAccessKey = params?.secretAccessKey || cfg?.secretAccessKey;
  const bucket = params?.bucket || cfg?.bucket;

  if (!accessKeyId || !secretAccessKey || !bucket) {
    throw new Error('Не заполнены обязательные параметры Yandex Storage (Имя бакета, Access Key ID, Secret Key)');
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

  await s3.send(new HeadBucketCommand({ Bucket: bucket }));

  return {
    success: true,
    message: `Бакет Yandex Object Storage "${bucket}" доступен (endpoint: ${endpoint})`,
  };
}
