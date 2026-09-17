/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

function getS3Client(): S3Client | null {
  const accessKeyId = process.env.YC_STORAGE_ACCESS_KEY || process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.YC_STORAGE_SECRET_KEY || process.env.S3_SECRET_KEY;

  if (!accessKeyId || !secretAccessKey) {
    return null;
  }

  return new S3Client({
    region: 'ru-central1',
    endpoint: 'https://storage.yandexcloud.net',
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    forcePathStyle: true,
  });
}

export async function uploadToObjectStorage(buffer: Buffer, key: string): Promise<void> {
  const bucket = process.env.YC_STORAGE_BUCKET || process.env.S3_BUCKET_NAME;
  if (!bucket) {
    throw new Error('YC_STORAGE_BUCKET не задан в переменных окружения');
  }

  const s3 = getS3Client();
  if (!s3) {
    throw new Error('Учетные данные YC_STORAGE_ACCESS_KEY / YC_STORAGE_SECRET_KEY не заданы');
  }

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: 'audio/mpeg',
    })
  );
  console.log(`[Object Storage] Файл ${key} успешно загружен в s3://${bucket}`);
}

export async function deleteFromObjectStorage(key: string): Promise<void> {
  const bucket = process.env.YC_STORAGE_BUCKET || process.env.S3_BUCKET_NAME;
  if (!bucket) return;

  const s3 = getS3Client();
  if (!s3) return;

  try {
    await s3.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      })
    );
    console.log(`[Object Storage] Файл ${key} удалён после распознавания`);
  } catch (err: any) {
    console.warn(`[Object Storage] Ошибка удаления файла ${key}:`, err.message);
  }
}
