/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import axios from 'axios';
import { getIamToken, isYandexAuthConfigured } from './yandex-auth.js';
import { uploadToObjectStorage, deleteFromObjectStorage } from './object-storage.js';

interface TranscriptSegment {
  speaker: 'manager' | 'client';
  text: string;
  startTime: number;
  endTime: number;
}

export function buildTranscript(chunks: any[]): string {
  if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
    return '';
  }

  const segments: TranscriptSegment[] = chunks.map(chunk => ({
    speaker: (chunk.channelTag === 1 ? 'manager' : 'client') as 'manager' | 'client',
    text: chunk.alternatives?.[0]?.text || '',
    startTime: (chunk.startMs || 0) / 1000,
    endTime: ((chunk.startMs || 0) + (chunk.lengthMs || 0)) / 1000,
  })).filter(s => s.text.trim().length > 0);

  if (segments.length === 0) {
    return '';
  }

  return segments
    .map(s => `${s.speaker === 'manager' ? 'Менеджер' : 'Клиент'}: ${s.text}`)
    .join('\n');
}

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

export async function transcribeWithRetry(audioBuffer: Buffer): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const transcript = await transcribeWithSpeechKit(audioBuffer);
      return transcript;
    } catch (error: any) {
      lastError = error as Error;
      console.error(
        `[SpeechKit] Попытка ${attempt}/${MAX_RETRIES} неудачна:`,
        error.message
      );

      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1); // 2с, 4с, 8с
        console.log(`[SpeechKit] Повтор через ${delay / 1000} сек...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  console.error('[SpeechKit] Все 3 попытки неудачны. Транскрибация отменена.');
  throw new Error(
    `SpeechKit недоступен после ${MAX_RETRIES} попыток: ${lastError?.message}`
  );
}

export async function transcribeWithSpeechKit(audioBuffer: Buffer): Promise<string> {
  if (!isYandexAuthConfigured()) {
    throw new Error('Yandex Cloud SpeechKit не настроен (отсутствует authorized_key.json)');
  }

  const iamToken = await getIamToken();
  let audioPayload: Record<string, any>;

  // < 1 MB: direct base64 transfer
  if (audioBuffer.length < 1024 * 1024) {
    audioPayload = {
      content: audioBuffer.toString('base64'),
    };
    return await requestAndPollRecognition(audioPayload, iamToken, null);
  } else {
    // >= 1 MB: upload to Yandex Object Storage, get s3 uri, then always delete
    const objectKey = `audio/${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`;
    await uploadToObjectStorage(audioBuffer, objectKey);
    const bucket = process.env.YC_STORAGE_BUCKET || process.env.S3_BUCKET_NAME;
    audioPayload = {
      uri: `s3://${bucket}/${objectKey}`,
    };

    try {
      return await requestAndPollRecognition(audioPayload, iamToken, objectKey);
    } finally {
      await deleteFromObjectStorage(objectKey).catch(err =>
        console.error('[Object Storage] Ошибка удаления:', err.message)
      );
    }
  }
}

async function requestAndPollRecognition(
  audioPayload: Record<string, any>,
  iamToken: string,
  _objectKey: string | null
): Promise<string> {
  const folderId = process.env.YC_FOLDER_ID;
  const url = folderId
    ? `https://transcribe.api.cloud.yandex.net/speech/stt/v2/asyncRecognize?folderId=${encodeURIComponent(folderId)}`
    : 'https://transcribe.api.cloud.yandex.net/speech/stt/v2/asyncRecognize';

  const startRes = await axios.post(
    url,
    {
      config: {
        specification: {
          languageCode: 'ru-RU',
          model: 'general',
          audioEncoding: 'MP3',
          sampleRateHertz: 8000,
          profanityFilter: false,
          literatureText: true,
          rawResults: false,
          audioChannelCount: 2,
        },
      },
      audio: audioPayload,
    },
    {
      headers: {
        Authorization: `Bearer ${iamToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );

  const operationId = startRes.data.id;
  if (!operationId) {
    throw new Error('SpeechKit не вернул operationId при запуске асинхронного распознавания');
  }

  console.log(`[SpeechKit] Запущена операция распознавания: ${operationId}. Ожидание результатов...`);

  // Poll for up to 60 iterations * 3s = 180s (3 minutes)
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const poll = await axios.get(
      `https://operation.api.cloud.yandex.net/operations/${operationId}`,
      { headers: { Authorization: `Bearer ${iamToken}` }, timeout: 15000 }
    );

    if (poll.data.done) {
      if (poll.data.error) {
        throw new Error(`SpeechKit error: ${JSON.stringify(poll.data.error)}`);
      }
      const chunks = poll.data.response?.chunks || [];
      const transcript = buildTranscript(chunks);
      console.log(`[SpeechKit] Операция ${operationId} успешно завершена (${chunks.length} сегментов)`);
      return transcript;
    }
  }

  throw new Error('SpeechKit: таймаут поллинга операции распознавания (3 минуты)');
}
