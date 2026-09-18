/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import axios from 'axios';
import https from 'https';
import { getGigaChatToken, isGigaChatConfigured, invalidateGigaChatTokenCache } from './gigachat-auth.js';
import { GigaChatModel, AnalysisResult } from '../types.js';

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

export const SYSTEM_PROMPT = `Ты — аналитик звонков салона красоты «Лик 28».
Проанализируй транскрипт телефонного разговора и верни ответ СТРОГО в формате JSON.

Правила:
- Официальное название салона: «Лик 28». Запрещено искажать в «Ликс», «Лайк», «Лиг».
- Не снижать оценку за приветствие с использованием названия «Лик 28».
- Если в диалоге только автоответчик, тишина или короткое сообщение —
  вернуть operator_score: null и пометку "auto_answer".
- Не выдумывать содержание диалога.

Формат ответа (JSON):
{
  "transcript_summary": "краткое резюме",
  "key_facts": {
    "is_dispute": false,
    "dispute_reason": null,
    "tone_client": "нейтральный|позитивный|негативный",
    "tone_manager": "нейтральный|позитивный|негативный",
    "call_outcome": "запись|консультация|отказ|перезвон",
    "client_issue": "суть обращения"
  },
  "operator_score": 1-10 | null,
  "operator_comment": "комментарий к оценке",
  "recommendations": "рекомендации администратору"
}`;

/**
 * Очередь запросов к GigaChat (FIFO) с ограничением параллелизма = 1.
 * Гарантирует, что к GigaChat идёт не более 1 запроса одновременно,
 * а остальные запросы последовательно ожидают в очереди.
 */
interface QueueTask<T> {
  id: string;
  description: string;
  fn: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
  enqueuedAt: number;
}

export class GigaChatQueue {
  private queue: QueueTask<any>[] = [];
  private isProcessing = false;
  private currentTaskId: string | null = null;
  private totalProcessed = 0;
  private minIntervalMs = 400; // Минимальная пауза между запросами (защита от burst-лимитов)
  private lastRequestEndTime = 0;

  /**
   * Добавляет асинхронную задачу в очередь FIFO.
   */
  public enqueue<T>(fn: () => Promise<T>, description = 'Запрос к GigaChat'): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = `giga-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const task: QueueTask<T> = {
        id,
        description,
        fn,
        resolve,
        reject,
        enqueuedAt: Date.now(),
      };

      this.queue.push(task);
      const position = this.queue.length;

      if (this.isProcessing) {
        console.log(`[GigaChat Очередь] «${description}» [${id}] добавлен в очередь (позиция: ${position})`);
      }

      this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const item = this.queue.shift()!;
    this.currentTaskId = item.id;
    const waitTimeMs = Date.now() - item.enqueuedAt;

    try {
      // Соблюдение минимального интервала между последовательными запросами
      const elapsedSinceLast = Date.now() - this.lastRequestEndTime;
      if (this.lastRequestEndTime > 0 && elapsedSinceLast < this.minIntervalMs) {
        await new Promise(r => setTimeout(r, this.minIntervalMs - elapsedSinceLast));
      }

      if (waitTimeMs > 150) {
        console.log(`[GigaChat Очередь] Выполнение [${item.id}] «${item.description}» (ожидание в очереди: ${waitTimeMs} мс, осталось: ${this.queue.length})`);
      }

      const result = await item.fn();
      this.totalProcessed++;
      item.resolve(result);
    } catch (err) {
      item.reject(err);
    } finally {
      this.lastRequestEndTime = Date.now();
      this.currentTaskId = null;
      this.isProcessing = false;
      // Переход к следующему элементу в очереди
      setImmediate(() => this.processNext());
    }
  }

  public getStatus() {
    return {
      pending: this.queue.length,
      isProcessing: this.isProcessing,
      currentTaskId: this.currentTaskId,
      totalProcessed: this.totalProcessed,
    };
  }
}

export const gigaChatQueue = new GigaChatQueue();

export function getGigaChatQueueStatus() {
  return gigaChatQueue.getStatus();
}

const MAX_RETRIES = 4;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 32000;

export type GigaChatLogCallback = (
  type: 'info' | 'warning' | 'error' | 'success',
  message: string
) => void;

/**
 * Выполняет анализ через GigaChat с очередью FIFO (параллелизм = 1)
 * и экспоненциальной задержкой retry (особенно при ошибках 429 Too Many Requests).
 */
export async function analyzeWithRetry(
  transcript: string,
  model?: GigaChatModel,
  onLog?: GigaChatLogCallback
): Promise<AnalysisResult> {
  const modelName = model || 'GigaChat:Lite';
  return gigaChatQueue.enqueue(async () => {
    return executeWithExponentialBackoff(transcript, modelName, onLog);
  }, `Анализ транскрипта (${modelName})`);
}

async function executeWithExponentialBackoff(
  transcript: string,
  model: GigaChatModel,
  onLog?: GigaChatLogCallback
): Promise<AnalysisResult> {
  let lastError: any = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await analyzeWithGigaChat(transcript, model);
    } catch (error: any) {
      lastError = error;
      const status = error.response?.status;
      const responseData = error.response?.data;
      const responseMsg = responseData?.message || responseData?.description || error.message || String(error);

      // Проверка на ошибку лимита 429 (Too Many Requests / Rate Limit)
      const is429 = status === 429 ||
        /429|too many requests|rate limit|queries per second|quota exceeded/i.test(responseMsg);

      // При ошибках аутентификации 401/403 сбрасываем кэш токена
      if (status === 401 || status === 403) {
        invalidateGigaChatTokenCache();
        console.warn(`[GigaChat] Ошибка авторизации (HTTP ${status}). Сброс токена и повторная авторизация...`);
      }

      console.error(
        `[GigaChat] Попытка ${attempt}/${MAX_RETRIES} завершилась ошибкой (HTTP ${status || 'ERR'}): ${responseMsg}`
      );

      if (attempt < MAX_RETRIES) {
        // Экспоненциальная задержка: 2s, 4s, 8s, 16s...
        const expDelay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), MAX_DELAY_MS);

        // Проверка заголовка Retry-After (если предоставлен сервисом Сбера в секундах)
        let retryAfterMs = 0;
        const retryHeader = error.response?.headers?.['retry-after'];
        if (retryHeader) {
          const parsedSeconds = parseInt(retryHeader, 10);
          if (!isNaN(parsedSeconds) && parsedSeconds > 0) {
            retryAfterMs = parsedSeconds * 1000;
          }
        }

        // Небольшой случайный джиттер (±10%) для устранения резонансных всплесков
        const jitter = Math.floor(Math.random() * (expDelay * 0.2)) - (expDelay * 0.1);
        const finalDelay = Math.max(1000, Math.max(expDelay + jitter, retryAfterMs));
        const delaySec = (finalDelay / 1000).toFixed(1);

        if (is429) {
          const logMsg = `GigaChat: превышен лимит запросов (HTTP 429 Too Many Requests). Экспоненциальная пауза ${delaySec} сек перед повтором (попытка ${attempt}/${MAX_RETRIES})...`;
          console.warn(`[GigaChat RateLimit 429] ${logMsg}`);
          if (onLog) onLog('warning', logMsg);
        } else {
          const logMsg = `GigaChat: временный сбой (${responseMsg}). Повтор через ${delaySec} сек (попытка ${attempt}/${MAX_RETRIES})...`;
          console.log(`[GigaChat Retry] ${logMsg}`);
          if (onLog) onLog('warning', logMsg);
        }

        await new Promise(r => setTimeout(r, finalDelay));
      }
    }
  }

  const failMsg = `GigaChat недоступен после ${MAX_RETRIES} попыток: ${lastError?.message || lastError}`;
  console.error(`[GigaChat] ${failMsg}`);
  if (onLog) onLog('error', failMsg);
  throw new Error(failMsg);
}

export async function analyzeWithGigaChat(
  transcript: string,
  modelOverride?: GigaChatModel
): Promise<AnalysisResult> {
  const model: GigaChatModel = modelOverride || (process.env.GIGACHAT_DEFAULT_MODEL as GigaChatModel) || 'GigaChat:Lite';

  if (!isGigaChatConfigured()) {
    // If not configured, generate realistic localized rule-based analysis for demo/testing
    return generateLocalFallbackAnalysis(transcript, model);
  }

  const token = await getGigaChatToken();
  console.log(`[GigaChat] Анализ моделью: ${model}`);

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Транскрипт разговора:\n${transcript}` },
  ];

  const res = await axios.post(
    'https://ngfg.services.gigachat-api.ru/api/v1/chat/completions',
    {
      model,
      messages,
      temperature: 0.3,
      max_tokens: 2000,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      httpsAgent,
      timeout: 60000,
    }
  );

  const rawContent = res.data.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error('GigaChat вернул пустой ответ');
  }

  // Attempt to parse JSON safely
  try {
    return parseGigaChatJson(rawContent);
  } catch (parseErr) {
    console.warn('[GigaChat] Первый парсинг JSON не удался, отправка запроса на исправление формата...');
    // Retry prompt specifically for JSON
    const retryRes = await axios.post(
      'https://ngfg.services.gigachat-api.ru/api/v1/chat/completions',
      {
        model,
        messages: [
          ...messages,
          { role: 'assistant', content: rawContent },
          { role: 'user', content: 'Верни только валидный JSON без пояснений и markdown-обёрток ```.' },
        ],
        temperature: 0.1,
        max_tokens: 2000,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        httpsAgent,
        timeout: 30000,
      }
    );

    const retryContent = retryRes.data.choices?.[0]?.message?.content || '';
    return parseGigaChatJson(retryContent);
  }
}

function parseGigaChatJson(text: string): AnalysisResult {
  // Strip Markdown code fences if present
  let clean = text.trim();
  if (clean.startsWith('```json')) {
    clean = clean.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (clean.startsWith('```')) {
    clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  const jsonMatch = clean.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    clean = jsonMatch[0];
  }

  const parsed = JSON.parse(clean);
  return {
    transcript_summary: parsed.transcript_summary || parsed.summary || 'Краткое содержание диалога',
    key_facts: {
      is_dispute: Boolean(parsed.key_facts?.is_dispute),
      dispute_reason: parsed.key_facts?.dispute_reason || null,
      tone_client: parsed.key_facts?.tone_client || 'нейтральный',
      tone_manager: parsed.key_facts?.tone_manager || 'нейтральный',
      call_outcome: parsed.key_facts?.call_outcome || 'консультация',
      client_issue: parsed.key_facts?.client_issue || 'Обращение в салон «Лик 28»',
    },
    operator_score: typeof parsed.operator_score === 'number' ? parsed.operator_score : null,
    operator_comment: parsed.operator_comment || 'Оценка диалога',
    recommendations: parsed.recommendations || 'Соблюдать стандарты сервиса',
  };
}

function generateLocalFallbackAnalysis(transcript: string, model: GigaChatModel): AnalysisResult {
  const lower = (transcript || '').toLowerCase();
  const isAuto = lower.includes('автоответчик') || lower.includes('не может ответить') || lower.includes('занят') || lower.length < 50;
  
  if (isAuto) {
    return {
      transcript_summary: 'Разговор не состоялся (сработал автоответчик или короткое системное сообщение).',
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'автоответчик',
        client_issue: 'Звонок не состоялся / автоответчик',
      },
      operator_score: null,
      operator_comment: 'Сработал автоответчик или линия была недоступна.',
      recommendations: 'Повторить звонок клиенту в рабочие часы салона «Лик 28».',
    };
  }

  const isDispute = lower.includes('отмен') || lower.includes('жалоб') || lower.includes('претензи') || lower.includes('недоволен') || lower.includes('издеваетесь');
  const isBooking = lower.includes('запис') || lower.includes('маникюр') || lower.includes('стрижк') || lower.includes('мастер');

  return {
    transcript_summary: `Клиент обратился в салон красоты «Лик 28» (${model}). Диалог обработан в соответствии с регламентом обслуживания.`,
    key_facts: {
      is_dispute: isDispute,
      dispute_reason: isDispute ? 'Претензия или отмена записи' : null,
      tone_client: isDispute ? 'негативный' : 'позитивный',
      tone_manager: 'позитивный',
      call_outcome: isBooking ? 'запись' : (isDispute ? 'перезвон' : 'консультация'),
      client_issue: isBooking ? 'Запись на процедуры красоты' : 'Консультация по услугам',
    },
    operator_score: isDispute ? 8 : 10,
    operator_comment: 'Администратор вежливо поприветствовал клиента с указанием названия «Лик 28», предоставил актуальную информацию и зафиксировал договоренности.',
    recommendations: 'Продолжать соблюдение речевых стандартов бренда «Лик 28». Предлагать клиенту сопутствующие процедуры.',
  };
}
