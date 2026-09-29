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
 * Определение длительности аудиофайла в секундах через ffprobe
 */
export function getAudioDuration(buffer: Buffer): number {
  try {
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const inPath = path.join(tempDir, `dur-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
    fs.writeFileSync(inPath, buffer);
    const out = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inPath}" 2>/dev/null`, { timeout: 10000 });
    try { fs.unlinkSync(inPath); } catch {}
    const duration = parseFloat(out.toString().trim());
    return isNaN(duration) ? 0 : duration;
  } catch {
    return 0;
  }
}

/**
 * Преобразование аудиозаписи в компактный моно OGG Opus 16kHz 24kbps.
 * Формат OGG Opus является нативным и наиболее стабильным для синхронного API Yandex SpeechKit.
 */
export function convertToOggOpus(buffer: Buffer): Buffer | null {
  try {
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const inPath = path.join(tempDir, `cv-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`);
    const outPath = path.join(tempDir, `cv-${Date.now()}-${Math.random().toString(36).slice(2)}.ogg`);
    fs.writeFileSync(inPath, buffer);
    execSync(`ffmpeg -y -i "${inPath}" -vn -c:a libopus -b:a 24k -ar 16000 -ac 1 "${outPath}" 2>/dev/null`, { timeout: 30000 });
    if (fs.existsSync(outPath)) {
      const result = fs.readFileSync(outPath);
      try { fs.unlinkSync(inPath); } catch {}
      try { fs.unlinkSync(outPath); } catch {}
      return result;
    }
    try { fs.unlinkSync(inPath); } catch {}
  } catch (err: any) {
    console.warn('[SpeechKit] Ошибка ffmpeg конвертации в oggopus:', err.message);
  }
  return null;
}

/**
 * Разбиение аудиозаписи на 24-секундные сегменты в формате Ogg Opus.
 * Синхронный метод Yandex SpeechKit имеет строгое ограничение (длительность аудио строго менее 30 секунд).
 */
export function splitAudioIntoOpusChunks(buffer: Buffer, chunkSeconds: number = 24): Buffer[] {
  const chunks: Buffer[] = [];
  try {
    const tempDir = path.join(process.cwd(), 'temp', `chunks-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const inPath = path.join(tempDir, 'source.tmp');
    fs.writeFileSync(inPath, buffer);
    execSync(`ffmpeg -y -i "${inPath}" -vn -c:a libopus -b:a 24k -ar 16000 -ac 1 -f segment -segment_time ${chunkSeconds} "${path.join(tempDir, 'chunk_%03d.ogg')}" 2>/dev/null`, { timeout: 60000 });
    const files = fs.readdirSync(tempDir).filter(f => f.startsWith('chunk_') && f.endsWith('.ogg')).sort();
    for (const f of files) {
      chunks.push(fs.readFileSync(path.join(tempDir, f)));
    }
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  } catch (err: any) {
    console.warn('[SpeechKit] Ошибка ffmpeg разбиения аудио на Opus-сегменты:', err.message);
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

function getChunkTimes(chunk: any): { startTime: number; endTime: number } {
  if (chunk.startMs !== undefined && chunk.startMs !== null) {
    const start = (Number(chunk.startMs) || 0) / 1000;
    const end = ((Number(chunk.startMs) || 0) + (Number(chunk.lengthMs) || 0)) / 1000;
    return { startTime: start, endTime: end };
  }
  const words = chunk.alternatives?.[0]?.words;
  if (Array.isArray(words) && words.length > 0) {
    const startStr = words[0]?.startTime || '0s';
    const endStr = words[words.length - 1]?.endTime || '0s';
    const start = parseFloat(String(startStr).replace('s', '')) || 0;
    const end = parseFloat(String(endStr).replace('s', '')) || 0;
    return { startTime: start, endTime: end };
  }
  return { startTime: 0, endTime: 0 };
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
      .map(c => {
        const times = getChunkTimes(c);
        return {
          text: (c.alternatives?.[0]?.text || '').trim(),
          startTime: times.startTime,
          endTime: times.endTime,
        };
      })
      .filter(s => s.text.length > 0)
      .sort((a, b) => a.startTime - b.startTime);

    return diarizeMonoUtterances(ch1Chunks);
  }

  // Проверяем, есть ли только 1 канал
  const uniqueChannels = new Set(chunks.map(c => Number(c.channelTag)));
  if (uniqueChannels.size <= 1) {
    const monoChunks = chunks
      .map(c => {
        const times = getChunkTimes(c);
        return {
          text: (c.alternatives?.[0]?.text || '').trim(),
          startTime: times.startTime,
          endTime: times.endTime,
        };
      })
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
      const times = getChunkTimes(chunk);
      return { speaker, text: text.trim(), startTime: times.startTime, endTime: times.endTime };
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
  const duration = getAudioDuration(audioBuffer);
  console.log(`[SpeechKit] Подготовка аудиозаписи (${Math.round(audioBuffer.length / 1024)} КБ, ${duration.toFixed(1)} сек.)`);

  // 1. Если настроен Yandex Object Storage и запись длиннее 25 секунд, используем асинхронное двухканальное распознавание
  if (bucket && duration >= 25) {
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
      console.log('[SpeechKit] Переключение на синхронное распознавание...');
    }
  }

  // 2. Если запись короче 28 секунд (лимит синхронного SpeechKit v1 — строго менее 30 секунд):
  // Конвертируем в нативный OGG Opus и распознаем напрямую
  if (duration > 0 && duration < 28) {
    try {
      const oggBuf = convertToOggOpus(audioBuffer);
      if (oggBuf) {
        const result = await transcribeSynchronous(oggBuf, authHeader, 'oggopus');
        if (result && result.trim()) {
          return refineTranscriptRoles(result.trim());
        }
      }
    } catch (syncErr: any) {
      console.warn('[SpeechKit] Прямое распознавание OGG Opus завершилось с ошибкой:', syncErr.message);
    }
  }

  // 3. Для длинных разговоров (или если прямое распознавание не сработало):
  // Разделение на 24-секундные Opus-сегменты (гарантирует отсутствие ошибки 400 "audio duration should be less than 30s")
  console.log(`[SpeechKit] Разделение аудио (${duration.toFixed(1)} сек.) на 24-секундные Opus-сегменты для пошагового распознавания...`);
  const chunks = splitAudioIntoOpusChunks(audioBuffer, 24);
  if (chunks.length > 0) {
    const chunkTexts: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      try {
        const text = await transcribeSynchronous(chunks[i], authHeader, 'oggopus');
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
  // Важно: в API v2 параметр folderId передается внутри JSON тела config.folderId, а не в query string!
  const url = 'https://transcribe.api.cloud.yandex.net/speech/stt/v2/longRunningRecognize';

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
  authHeader: string,
  format: 'oggopus' | 'lpcm' = 'oggopus'
): Promise<string> {
  const folderId = getYandexFolderId();
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
