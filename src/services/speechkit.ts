/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import axios from 'axios';
import * as fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getYandexAuthHeader, getYandexFolderId, isYandexAuthConfigured } from './yandex-auth.js';
import { uploadToObjectStorage, deleteFromObjectStorage, getYandexStorageBucket } from './object-storage.js';
import {
  calculateTextSimilarity,
  splitConjoinedLines,
  refineTranscriptRoles,
  fixDuplicatedTranscript
} from './transcriptUtils.js';

export {
  calculateTextSimilarity,
  splitConjoinedLines,
  refineTranscriptRoles,
  fixDuplicatedTranscript
};

interface TranscriptSegment {
  speaker: 'manager' | 'client';
  text: string;
  startTime: number;
  endTime: number;
}

/**
 * Определение формата аудио по первым сигнатурным байтам (magic numbers)
 */
export function detectAudioFormat(buffer: Buffer): 'mp3' | 'oggopus' | 'lpcm' {
  if (!buffer || buffer.length < 4) return 'mp3';
  // MP3: ID3 (0x49 0x44 0x33) или MPEG sync (0xFF 0xEx/0xFx)
  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) return 'mp3';
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'mp3';
  // OGG: OggS (0x4F 0x67 0x67 0x53)
  if (buffer[0] === 0x4f && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) return 'oggopus';
  // WAV: RIFF
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return 'lpcm';
  return 'mp3';
}

/**
 * Сжатие аудиозаписи с помощью ffmpeg в моно 16kHz 24kbps MP3
 * (уменьшает объем файла в 3-5 раз, сохраняя максимальную разборчивость речи для SpeechKit)
 */
function compressAudioToMonoMp3(buffer: Buffer): Buffer | null {
  try {
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const inPath = path.join(tempDir, `comp-in-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);
    const outPath = path.join(tempDir, `comp-out-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`);
    fs.writeFileSync(inPath, buffer);
    execSync(`ffmpeg -y -i "${inPath}" -vn -ac 1 -ar 16000 -b:a 24k "${outPath}" 2>/dev/null`, { timeout: 30000 });
    if (fs.existsSync(outPath)) {
      const result = fs.readFileSync(outPath);
      try { fs.unlinkSync(inPath); } catch {}
      try { fs.unlinkSync(outPath); } catch {}
      return result;
    }
    try { fs.unlinkSync(inPath); } catch {}
  } catch (err: any) {
    console.warn('[SpeechKit] Ошибка ffmpeg сжатия аудио:', err.message);
  }
  return null;
}

/**
 * Разбиение аудиозаписи на 25-секундные сегменты с помощью ffmpeg
 * Позволяет распознавать разговоры любой длительности без настройки Object Storage
 */
function splitAudioIntoChunks(buffer: Buffer, chunkSeconds: number = 25): Buffer[] {
  const chunks: Buffer[] = [];
  try {
    const tempDir = path.join(process.cwd(), 'temp', `chunks-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const inPath = path.join(tempDir, 'source.mp3');
    fs.writeFileSync(inPath, buffer);
    execSync(`ffmpeg -y -i "${inPath}" -vn -ac 1 -ar 16000 -b:a 24k -f segment -segment_time ${chunkSeconds} "${path.join(tempDir, 'chunk_%03d.mp3')}" 2>/dev/null`, { timeout: 60000 });
    const files = fs.readdirSync(tempDir).filter(f => f.startsWith('chunk_') && f.endsWith('.mp3')).sort();
    for (const f of files) {
      chunks.push(fs.readFileSync(path.join(tempDir, f)));
    }
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  } catch (err: any) {
    console.warn('[SpeechKit] Ошибка ffmpeg разбиения аудио:', err.message);
  }
  return chunks;
}

/**
 * Проверяет, является ли распознавание dual-mono (когда в оба канала записан один и тот же звук)
 */
export function isDualMonoChunks(chunks: any[]): boolean {
  if (!chunks || !Array.isArray(chunks) || chunks.length === 0) return false;

  const ch1 = chunks.filter(c => Number(c.channelTag) === 1);
  const ch2 = chunks.filter(c => Number(c.channelTag) === 2);

  if (ch1.length === 0 || ch2.length === 0) {
    return false; // Только один канал
  }

  const texts1 = ch1.map(c => (c.alternatives?.[0]?.text || '').trim().toLowerCase()).filter(Boolean);
  const texts2 = ch2.map(c => (c.alternatives?.[0]?.text || '').trim().toLowerCase()).filter(Boolean);

  if (texts1.length === 0 || texts2.length === 0) return false;

  // Проверяем, сколько фраз из канала 1 имеют дубликат в канале 2
  let duplicateCount = 0;
  for (const t1 of texts1) {
    if (texts2.some(t2 => t1 === t2 || calculateTextSimilarity(t1, t2) > 0.6)) {
      duplicateCount++;
    }
  }

  const matchRatio = duplicateCount / Math.min(texts1.length, texts2.length);
  return matchRatio >= 0.25; // Если 25%+ фраз одинаковы, это dual-mono
}

/**
 * Интеллектуальное разделение ролей (Менеджер / Клиент) для моно-диалога
 */
export function diarizeMonoUtterances(
  utterances: { text: string; startTime?: number; endTime?: number }[]
): string {
  if (!utterances || utterances.length === 0) return '';

  // 1. Устраняем последовательные дубликаты / эхо
  const cleanList: string[] = [];
  for (let i = 0; i < utterances.length; i++) {
    const rawText = utterances[i].text.trim();
    if (!rawText) continue;

    if (cleanList.length > 0) {
      const prev = cleanList[cleanList.length - 1];
      if (calculateTextSimilarity(rawText, prev) > 0.65) {
        // Оставляем более полную фразу
        if (rawText.length > prev.length) {
          cleanList[cleanList.length - 1] = rawText;
        }
        continue;
      }
    }
    cleanList.push(rawText);
  }

  if (cleanList.length === 0) return '';

  return refineTranscriptRoles(cleanList.join('\n'));
}

export function buildTranscript(chunks: any[]): string {
  if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
    return '';
  }

  // Проверка: это dual-mono (одинаковый звук в двух каналах) или один канал?
  if (isDualMonoChunks(chunks)) {
    console.log('[SpeechKit] Обнаружена одноканальная/дублированная аудиозапись (dual-mono). Исключаем дублирование каналов и применяем ролевую диаризацию.');
    // Берём только сегменты первого канала
    const ch1Chunks = chunks
      .filter(c => Number(c.channelTag) === 1)
      .map(c => ({
        text: (c.alternatives?.[0]?.text || '').trim(),
        startTime: (Number(c.startMs) || 0) / 1000,
        endTime: ((Number(c.startMs) || 0) + (Number(c.lengthMs) || 0)) / 1000,
      }))
      .filter(s => s.text.length > 0)
      .sort((a, b) => a.startTime - b.startTime);

    return diarizeMonoUtterances(ch1Chunks);
  }

  // Проверяем, есть ли только 1 канал
  const uniqueChannels = new Set(chunks.map(c => Number(c.channelTag)));
  if (uniqueChannels.size <= 1) {
    const monoChunks = chunks
      .map(c => ({
        text: (c.alternatives?.[0]?.text || '').trim(),
        startTime: (Number(c.startMs) || 0) / 1000,
        endTime: ((Number(c.startMs) || 0) + (Number(c.lengthMs) || 0)) / 1000,
      }))
      .filter(s => s.text.length > 0)
      .sort((a, b) => a.startTime - b.startTime);

    return diarizeMonoUtterances(monoChunks);
  }

  // Истинный стерео-режим (2 независимых аудиоканала: 1 = менеджер, 2 = клиент)
  const segments: TranscriptSegment[] = chunks
    .map(chunk => {
      const channel = Number(chunk.channelTag);
      const speaker: 'manager' | 'client' = channel === 1 ? 'manager' : 'client';
      const text = chunk.alternatives?.[0]?.text || '';
      const startTime = (Number(chunk.startMs) || 0) / 1000;
      const endTime = ((Number(chunk.startMs) || 0) + (Number(chunk.lengthMs) || 0)) / 1000;
      return { speaker, text: text.trim(), startTime, endTime };
    })
    .filter(s => s.text.length > 0);

  if (segments.length === 0) {
    return '';
  }

  // Sort chronologically by start time so the dialogue flows naturally
  segments.sort((a, b) => a.startTime - b.startTime);

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
      const errorDetail = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      console.error(
        `[SpeechKit] Попытка ${attempt}/${MAX_RETRIES} неудачна:`,
        errorDetail
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
    throw new Error('Yandex Cloud SpeechKit не настроен: укажите API-ключ (YC_API_KEY) или загрузите authorized_key.json в разделе настроек системы');
  }

  const authHeader = await getYandexAuthHeader();
  const bucket = getYandexStorageBucket();

  // 1. Если настроен Yandex Object Storage, используем двухканальное асинхронное распознавание
  if (bucket) {
    try {
      const objectKey = `audio/${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`;
      await uploadToObjectStorage(audioBuffer, objectKey);
      const audioUri = `https://storage.yandexcloud.net/${bucket}/${objectKey}`;

      try {
        return await requestAndPollLongRunning(audioUri, authHeader);
      } finally {
        await deleteFromObjectStorage(objectKey).catch(err =>
          console.error('[Object Storage] Ошибка удаления временного аудиофайла:', err.message)
        );
      }
    } catch (asyncErr: any) {
      console.warn('[SpeechKit] Ошибка асинхронного распознавания через Object Storage:', asyncErr.message);
      console.log('[SpeechKit] Переключение на прямое синхронное распознавание...');
    }
  }

  // 2. Прямое синхронное распознавание для файлов до 1 МБ
  if (audioBuffer.length < 1000 * 1024) {
    try {
      const result = await transcribeSynchronous(audioBuffer, authHeader);
      if (result && result.trim()) {
        return refineTranscriptRoles(result.trim());
      }
    } catch (syncErr: any) {
      console.warn('[SpeechKit] Синхронное распознавание исходного файла завершилось с ошибкой:', syncErr.message);
    }
  }

  // 3. Если Object Storage не настроен или файл > 1 МБ: сжатие через ffmpeg в моно 16kHz 24kbps
  console.log(`[SpeechKit] Аудиофайл (${Math.round(audioBuffer.length / 1024)} КБ) превышает лимит или требует нормализации. Сжатие ffmpeg...`);
  const compressed = compressAudioToMonoMp3(audioBuffer);
  if (compressed && compressed.length < 1000 * 1024) {
    try {
      console.log(`[SpeechKit] Сжато до ${Math.round(compressed.length / 1024)} КБ. Запуск синхронного распознавания...`);
      const result = await transcribeSynchronous(compressed, authHeader);
      if (result && result.trim()) {
        return refineTranscriptRoles(result.trim());
      }
    } catch (compErr: any) {
      console.warn('[SpeechKit] Ошибка распознавания сжатого аудио:', compErr.message);
    }
  }

  // 4. Для длинных разговоров: разделение ffmpeg на 25-секундные сегменты
  console.log('[SpeechKit] Разделение длинной записи на 25-секундные сегменты для пошагового синхронного распознавания...');
  const chunks = splitAudioIntoChunks(compressed || audioBuffer, 25);
  if (chunks.length > 0) {
    const chunkTexts: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      try {
        const text = await transcribeSynchronous(chunks[i], authHeader);
        if (text && text.trim()) {
          chunkTexts.push(text.trim());
        }
      } catch (chunkErr: any) {
        console.warn(`[SpeechKit] Ошибка распознавания сегмента ${i + 1}/${chunks.length}:`, chunkErr.message);
      }
    }
    if (chunkTexts.length > 0) {
      const fullText = chunkTexts.join(' ');
      console.log(`[SpeechKit] Успешно расшифровано ${chunkTexts.length} сегментов (${fullText.length} симв.)`);
      return refineTranscriptRoles(fullText);
    }
  }

  throw new Error('Не удалось расшифровать аудиозапись через Yandex SpeechKit. Проверьте правильность настроек API-ключа или бакета Object Storage.');
}

async function requestAndPollLongRunning(
  audioUri: string,
  authHeader: string
): Promise<string> {
  const folderId = getYandexFolderId();
  const url = folderId
    ? `https://transcribe.api.cloud.yandex.net/speech/stt/v2/longRunningRecognize?folderId=${encodeURIComponent(folderId)}`
    : 'https://transcribe.api.cloud.yandex.net/speech/stt/v2/longRunningRecognize';

  console.log(`[SpeechKit] Отправка запроса на асинхронное распознавание: ${audioUri}`);

  // Для формата MP3 параметр sampleRateHertz не указывается по официальной документации Yandex Cloud
  const startRes = await axios.post(
    url,
    {
      config: {
        specification: {
          languageCode: 'ru-RU',
          model: 'general',
          audioEncoding: 'MP3',
          profanityFilter: false,
          literatureText: true,
          rawResults: false,
        },
        folderId: folderId || undefined,
      },
      audio: {
        uri: audioUri,
      },
    },
    {
      headers: {
        Authorization: authHeader,
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
      { headers: { Authorization: authHeader }, timeout: 15000 }
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

async function transcribeSynchronous(
  audioBuffer: Buffer,
  authHeader: string
): Promise<string> {
  const folderId = getYandexFolderId();
  const format = detectAudioFormat(audioBuffer);
  const query = new URLSearchParams({
    lang: 'ru-RU',
    topic: 'general',
    profanityFilter: 'false',
    format: format,
  });
  if (folderId) {
    query.set('folderId', folderId);
  }

  const syncRes = await axios.post(
    `https://stt.api.cloud.yandex.net/speech/v1/stt:recognize?${query.toString()}`,
    audioBuffer,
    {
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/octet-stream',
      },
      timeout: 45000,
    }
  );

  if (syncRes.data?.result) {
    return syncRes.data.result;
  }

  return '';
}
