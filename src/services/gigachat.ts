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

export const SYSTEM_PROMPT = `Ты — ведущий эксперт контроля качества и аналитик звонков салона красоты «Лик 28».
Проанализируй предоставленный транскрипт телефонного разговора и верни структурированный ответ СТРОГО в формате JSON.

ОБЯЗАТЕЛЬНЫЕ ТРЕБОВАНИЯ К АНАЛИЗУ:

1. СТРОГОЕ РАЗДЕЛЕНИЕ РЕПЛИК ПО РОЛЯМ (Клиент / Менеджер):
   - Разделяй реплики диалога СТРОГО по двум ролям: «Менеджер» (администратор салона) и «Клиент» (звонящий).
   - Каждая реплика в поле formatted_transcript ОБЯЗАТЕЛЬНО должна быть записана в формате: 'Имя: Текст' (например, 'Менеджер: Текст реплики' или 'Клиент: Текст реплики').
   - Каждая реплика пишется с новой строки. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО склеивать реплики разных говорящих в одну строку или абзац!
   - Если в предоставленном транскрипте реплики склеены или отсутствует разметка ролей — восстанови диалог и раздели фразы строго по ролям 'Менеджер: ...' и 'Клиент: ...'.

2. КРАТКОЕ СОДЕРЖАНИЕ (transcript_summary):
   - Должно содержать 2-4 предложения и отражать ВСЮ цепочку разговора:
     а) Запрос клиента: мастер, услуга, желаемые дата/время.
     б) Что предложил администратор: доступные слоты, альтернативные мастера.
     в) ОБЯЗАТЕЛЬНЫЙ ФИНАЛЬНЫЙ ВЫВОД И СТАТУС ЗАПИСИ: явно зафиксируй, согласился клиент на запись или отказался (с четким указанием причины: не подходит время, не будет в городе, дорого, подумает и т.д.), либо была ли это только консультация.
   - КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО обрывать резюме без фиксации согласия или отказа клиента!

3. СТАТУС ЗАПИСИ В ОТДЕЛЬНОМ ПОЛЕ (booking_status):
   - В обязательном отдельном поле JSON 'booking_status' укажи строго одно из значений:
     * "согласие" — клиент согласился на предложенное время и подтвердил запись на услугу;
     * "отказ" — клиент отказался от предложенного времени/записи (не подходит слот, не будет в городе, передумал, отказался);
     * "консультация" — клиент получил справочную информацию без согласования записи;
     * "не применимо" — звонок не состоялся, сброс или автоответчик.
   - Значение поля 'booking_status' должно строго и однозначно отражать согласие или отказ клиента!

4. КЛЮЧЕВЫЕ ФАКТЫ (key_facts):
   - call_outcome: строго одно из значений:
     * "запись" — клиент согласился и запись подтверждена;
     * "отказ" — предложенное время/условия клиенту не подошли, клиент отказался от записи;
     * "консультация" — клиент получил справочную информацию без оформления записи;
     * "перезвон" — договорились о повторном звонке;
     * "отмена" — клиент отменил существующую запись;
     * "автоответчик" — сработал автоответчик или линия недоступна.
   - booking_status: строго дублирует статус записи ("согласие"|"отказ"|"консультация"|"не применимо").
   - client_issue: конкретная суть запроса клиента (например: "Запись на оформление челки к мастеру Надежде").

5. ОЦЕНКА ОПЕРАТОРА:
   - Для состоявшегося диалога с клиентом обязательно выставить operator_score (число от 1 до 10) и краткий содержательный комментарий operator_comment.
   - Если в диалоге только автоответчик или сброс — вернуть operator_score: null.

6. РЕГЛАМЕНТ САЛОНА:
   - Официальное название салона: «Лик 28».
   - Не снижать оценку за приветствие с названием «Лик 28».
   - Не выдумывать факты, которых нет в разговоре.

Формат ответа (JSON):
{
  "transcript_summary": "Краткое содержание с обязательным указанием финального статуса записи (согласие / отказ и по какой конкретно причине).",
  "booking_status": "согласие|отказ|консультация|не применимо",
  "formatted_transcript": "Менеджер: Добрый день, салон «Лик 28», слушаю вас.\\nКлиент: Здравствуйте, хочу записаться...\\nМенеджер: Да, конечно...",
  "key_facts": {
    "is_dispute": false,
    "dispute_reason": null,
    "tone_client": "нейтральный|позитивный|негативный",
    "tone_manager": "нейтральный|позитивный|негативный",
    "call_outcome": "запись|отказ|консультация|перезвон|отмена|автоответчик",
    "booking_status": "согласие|отказ|консультация|не применимо",
    "client_issue": "суть обращения"
  },
  "operator_score": 1-10 | null,
  "operator_comment": "комментарий к оценке администратора",
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

  const gigachatApiUrl = process.env.GIGACHAT_API_URL || 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions';

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Транскрипт разговора:\n${transcript}` },
  ];

  const res = await axios.post(
    gigachatApiUrl,
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
      gigachatApiUrl,
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
  const isAutoAnswer = parsed.key_facts?.call_outcome === 'автоответчик' || parsed.booking_status === 'не применимо';
  const score = typeof parsed.operator_score === 'number'
    ? parsed.operator_score
    : (isAutoAnswer ? null : 9);

  // Normalize booking_status ('согласие' | 'отказ' | 'консультация' | 'не применимо')
  let bookingStatus: string = String(parsed.booking_status || parsed.key_facts?.booking_status || '').toLowerCase().trim();
  const rawOutcome: string = String(parsed.key_facts?.call_outcome || '').toLowerCase().trim();

  if (!bookingStatus || !['согласие', 'отказ', 'консультация', 'не применимо'].includes(bookingStatus)) {
    if (bookingStatus.includes('соглас') || rawOutcome === 'запись' || rawOutcome === 'успешно') {
      bookingStatus = 'согласие';
    } else if (bookingStatus.includes('отказ') || rawOutcome === 'отказ') {
      bookingStatus = 'отказ';
    } else if (rawOutcome === 'автоответчик' || isAutoAnswer) {
      bookingStatus = 'не применимо';
    } else {
      bookingStatus = 'консультация';
    }
  }

  // Ensure call_outcome is consistent with booking_status
  let outcome = rawOutcome || 'консультация';
  if (bookingStatus === 'согласие' && outcome !== 'запись') {
    outcome = 'запись';
  } else if (bookingStatus === 'отказ' && outcome !== 'отказ') {
    outcome = 'отказ';
  }

  const formattedTranscript = typeof parsed.formatted_transcript === 'string' && parsed.formatted_transcript.trim().length > 0
    ? parsed.formatted_transcript.trim()
    : undefined;

  return {
    transcript_summary: parsed.transcript_summary || parsed.summary || 'Краткое содержание диалога с результатом обращения.',
    booking_status: bookingStatus,
    formatted_transcript: formattedTranscript,
    key_facts: {
      is_dispute: Boolean(parsed.key_facts?.is_dispute),
      dispute_reason: parsed.key_facts?.dispute_reason || null,
      tone_client: parsed.key_facts?.tone_client || 'нейтральный',
      tone_manager: parsed.key_facts?.tone_manager || 'нейтральный',
      call_outcome: outcome,
      booking_status: bookingStatus,
      client_issue: parsed.key_facts?.client_issue || 'Обращение в салон «Лик 28»',
    },
    operator_score: score,
    operator_comment: parsed.operator_comment && parsed.operator_comment.trim().length > 0
      ? parsed.operator_comment
      : (isAutoAnswer ? 'Сработал автоответчик или короткое соединение.' : 'Администратор вежливо обработал обращение, соблюдая регламент салона «Лик 28».'),
    recommendations: parsed.recommendations || 'Соблюдать стандарты сервиса салона «Лик 28».',
  };
}

function generateLocalFallbackAnalysis(transcript: string, model: GigaChatModel): AnalysisResult {
  const lower = (transcript || '').toLowerCase();
  const isAuto = lower.includes('автоответчик') || lower.includes('не может ответить') || lower.includes('занят') || lower.length < 50;
  
  if (isAuto) {
    return {
      transcript_summary: 'Разговор не состоялся (сработал автоответчик или короткое системное сообщение). Запись не оформлена.',
      booking_status: 'не применимо',
      formatted_transcript: transcript,
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'автоответчик',
        booking_status: 'не применимо',
        client_issue: 'Звонок не состоялся / автоответчик',
      },
      operator_score: null,
      operator_comment: 'Сработал автоответчик или линия была недоступна.',
      recommendations: 'Повторить звонок клиенту в рабочие часы салона «Лик 28».',
    };
  }

  const isDispute = lower.includes('отмен') || lower.includes('жалоб') || lower.includes('претензи') || lower.includes('недоволен') || lower.includes('издеваетесь');
  const isDeclined = lower.includes('не будет в городе') || lower.includes('не смогу') || lower.includes('не получается') || lower.includes('неудобно') || lower.includes('не подходит');
  const isBooking = !isDeclined && (lower.includes('записали') || lower.includes('до встречи') || lower.includes('ждем вас'));

  const outcome = isBooking ? 'запись' : (isDeclined ? 'отказ' : (isDispute ? 'перезвон' : 'консультация'));
  const bookingStatus = isBooking ? 'согласие' : (isDeclined ? 'отказ' : (isDispute ? 'консультация' : 'консультация'));
  const outcomeText = isBooking
    ? 'Запись успешно подтверждена и зафиксирована.'
    : (isDeclined
      ? 'Клиент отказалась от предложенных вариантов записи из-за невозможности быть в городе / неподходящего времени. Разговор завершился отказом от записи.'
      : 'Разговор завершился справочной консультацией.');

  return {
    transcript_summary: `Клиент обратилась в салон красоты «Лик 28» по поводу записи на услуги. Администратор проверила график мастера и предложила доступные варианты. Итог: ${outcomeText}`,
    booking_status: bookingStatus,
    formatted_transcript: transcript,
    key_facts: {
      is_dispute: isDispute,
      dispute_reason: isDispute ? 'Претензия или отмена записи' : null,
      tone_client: isDispute ? 'негативный' : 'позитивный',
      tone_manager: 'позитивный',
      call_outcome: outcome,
      booking_status: bookingStatus,
      client_issue: 'Запись на процедуры в салоне «Лик 28»',
    },
    operator_score: isDispute ? 8 : 10,
    operator_comment: 'Администратор вежливо поприветствовал клиента с указанием названия «Лик 28», проверил расписание и предложил доступные слоты.',
    recommendations: 'Продолжать соблюдение речевых стандартов бренда «Лик 28». Предлагать клиенту запись на другие даты.',
  };
}
