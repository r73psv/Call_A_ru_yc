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
   - Если реплики склеены в одну строку — раздели их на реплики Менеджера и Клиента.
   - КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО ПРИДУМЫВАТЬ ИЛИ ВЫМЫШЛЯТЬ НЕСУЩЕСТВУЮЩИЙ ДИАЛОГ! Если в транскрипте нет диалога (тишина, гудки, сброс, менее 10 секунд, обрыв или автоответчик), запиши в formatted_transcript 'Разговор не состоялся (диалог отсутствует)', НЕ СОЧИНЯЙ диалог от себя!

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

5. ОЦЕНКА ОПЕРАТОРА (operator_score) И КОРОТКИЕ РАЗГОВОРЫ (10–60 СЕКУНД):
   - ВНИМАНИЕ: СТРОЖАЙШИЙ ЗАПРЕТ ФАНТАЗИРОВАНИЯ И ВЫСТАВЛЕНИЯ ОЦЕНОК ПРИ НЕСОСТОЯВШИХСЯ РАЗГОВОРАХ И ЗВОНКАХ МЕНЕЕ 10 СЕКУНД!
   - Если звонок длился менее 10 секунд, сброшен, сработал автоответчик, автоинформатор, голосовая почта, гудки, тишина или абонент не ответил:
     * operator_score ОБЯЗАН БЫТЬ СТРОГО null (НЕ число, НЕ 0, а именно null)! КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО выдумывать диалог и ставить оценку!
     * operator_comment: "Разговор не состоялся (длительность менее 10 секунд или сработал автоответчик/автоинформатор)."
     * booking_status: "не применимо"
     * call_outcome: "не состоялся"
     * recommendations: "Повторить попытку дозвона клиенту в рабочее время салона «Лик 28»."
     * transcript_summary: "Разговор не состоялся: длительность вызова менее 10 секунд или диалог отсутствует."
   - ВАЖНО ПО ЗВОНКАМ ДЛИТЕЛЬНОСТЬЮ ОТ 10 СЕКУНД ДО 1 МИНУТЫ:
     * Звонки от 10 секунд до 1 минуты ЧАСТО являются короткими, но ПОЛНОЦЕННЫМИ разговорами (например, клиент быстро спросил график работы, цену или перенес визит, администратор ответил).
     * Если клиент и администратор обменялись хотя бы 1-2 реальными репликами — ЭТО СОСТОЯВШИЙСЯ РАЗГОВОР! КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО писать "разговор не состоялся" для таких звонков!
     * Сформируй точное резюме сути вопроса клиента, укажи booking_status ("консультация", "согласие" или "отказ") и оцени работу оператора (1-10).
   - Оценка оператора (число от 1 до 10) выставляется ТОЛЬКО если состоялся РЕАЛЬНЫЙ диалог.

6. РЕГЛАМЕНТ САЛОНА:
   - Официальное название салона: «Лик 28».
   - Не снижать оценку за приветствие с названием «Лик 28».
   - Категорически запрещено выдумывать факты, фразы или обстоятельства, которых нет в стенограмме разговора.

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
  "operator_comment": "комментарий к оценке администратора (или фиксация автоответчика)",
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
  onLog?: GigaChatLogCallback,
  callDurationSeconds?: number
): Promise<AnalysisResult> {
  const modelName = model || 'GigaChat:Lite';
  return gigaChatQueue.enqueue(async () => {
    return executeWithExponentialBackoff(transcript, modelName, onLog, callDurationSeconds);
  }, `Анализ транскрипта (${modelName})`);
}

async function executeWithExponentialBackoff(
  transcript: string,
  model: GigaChatModel,
  onLog?: GigaChatLogCallback,
  callDurationSeconds?: number
): Promise<AnalysisResult> {
  let lastError: any = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await analyzeWithGigaChat(transcript, model, callDurationSeconds);
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
  modelOverride?: GigaChatModel,
  callDurationSeconds?: number
): Promise<AnalysisResult> {
  const model: GigaChatModel = modelOverride || (process.env.GIGACHAT_DEFAULT_MODEL as GigaChatModel) || 'GigaChat:Lite';

  // Strict guard: if call duration is under 10 seconds, immediately return unheld call without calling LLM
  if (callDurationSeconds !== undefined && callDurationSeconds < 10) {
    return generateLocalFallbackAnalysis(transcript, model, callDurationSeconds);
  }

  if (!isGigaChatConfigured()) {
    // If not configured, generate realistic localized rule-based analysis for demo/testing
    return generateLocalFallbackAnalysis(transcript, model, callDurationSeconds);
  }

  const token = await getGigaChatToken();
  console.log(`[GigaChat] Анализ моделью: ${model} (длительность звонка: ${callDurationSeconds ?? 'не указана'} сек.)`);

  const gigachatApiUrl = process.env.GIGACHAT_API_URL || 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions';

  const userPromptContent = callDurationSeconds !== undefined
    ? `Фактическая длительность звонка: ${callDurationSeconds} сек.\nТранскрипт разговора:\n${transcript}`
    : `Транскрипт разговора:\n${transcript}`;

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPromptContent },
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
  const formattedTranscript = typeof parsed.formatted_transcript === 'string' && parsed.formatted_transcript.trim().length > 0
    ? parsed.formatted_transcript.trim()
    : undefined;

  const combinedText = (
    (formattedTranscript || '') + ' ' +
    (parsed.transcript_summary || '') + ' ' +
    (parsed.summary || '') + ' ' +
    (parsed.key_facts?.client_issue || '') + ' ' +
    (parsed.operator_comment || '')
  ).toLowerCase();

  // Strict detection of auto-attendant, auto-informer, voicemail, silence or failed connection
  const isAutoOrFailed = 
    parsed.key_facts?.call_outcome === 'автоответчик' ||
    parsed.key_facts?.call_outcome === 'не состоялся' ||
    parsed.booking_status === 'не применимо' ||
    combinedText.includes('автоответчик') ||
    combinedText.includes('автоинформатор') ||
    combinedText.includes('голосовой помощник') ||
    combinedText.includes('голосовая почта') ||
    combinedText.includes('оставьте сообщение') ||
    combinedText.includes('после сигнала') ||
    combinedText.includes('не может ответить') ||
    combinedText.includes('абонент временно недоступен') ||
    combinedText.includes('абонент занят') ||
    combinedText.includes('линия занята') ||
    combinedText.includes('набранный вами номер') ||
    combinedText.includes('пожалуйста, перезвоните') ||
    combinedText.includes('все операторы заняты') ||
    combinedText.includes('переадресация вызова') ||
    combinedText.includes('разговор не состоялся') ||
    combinedText.includes('звонок не состоялся') ||
    combinedText.includes('не ответил') ||
    combinedText.includes('пропущенный');

  // If auto-responder / informer detected, FORBID fantasy score and FORCE score = null
  let score: number | null = null;
  if (!isAutoOrFailed && typeof parsed.operator_score === 'number' && !isNaN(parsed.operator_score)) {
    score = Math.max(1, Math.min(10, Math.round(parsed.operator_score)));
  }

  // Normalize booking_status ('согласие' | 'отказ' | 'консультация' | 'не применимо')
  let bookingStatus: string = isAutoOrFailed 
    ? 'не применимо' 
    : String(parsed.booking_status || parsed.key_facts?.booking_status || '').toLowerCase().trim();
  const rawOutcome: string = String(parsed.key_facts?.call_outcome || '').toLowerCase().trim();

  if (!isAutoOrFailed) {
    if (!bookingStatus || !['согласие', 'отказ', 'консультация', 'не применимо'].includes(bookingStatus)) {
      if (bookingStatus.includes('соглас') || rawOutcome === 'запись' || rawOutcome === 'успешно') {
        bookingStatus = 'согласие';
      } else if (bookingStatus.includes('отказ') || rawOutcome === 'отказ') {
        bookingStatus = 'отказ';
      } else {
        bookingStatus = 'консультация';
      }
    }
  }

  // Ensure call_outcome is consistent with booking_status and auto-responder detection
  let outcome = isAutoOrFailed ? 'автоответчик' : (rawOutcome || 'консультация');
  if (!isAutoOrFailed) {
    if (bookingStatus === 'согласие' && outcome !== 'запись') {
      outcome = 'запись';
    } else if (bookingStatus === 'отказ' && outcome !== 'отказ') {
      outcome = 'отказ';
    }
  }

  const summary = isAutoOrFailed
    ? 'Разговор не состоялся: сработал автоответчик, автоинформатор или линия была недоступна. Запись не оформлена.'
    : (parsed.transcript_summary || parsed.summary || 'Краткое содержание диалога с результатом обращения.');

  const comment = isAutoOrFailed
    ? 'Разговор не состоялся: зафиксирован автоответчик или автоинформатор (оценка оператора не выставляется).'
    : (parsed.operator_comment && parsed.operator_comment.trim().length > 0
        ? parsed.operator_comment
        : 'Администратор вежливо обработал обращение, соблюдая регламент салона «Лик 28».');

  const recommendations = isAutoOrFailed
    ? 'Повторить попытку дозвона клиенту в рабочее время салона «Лик 28».'
    : (parsed.recommendations || 'Соблюдать стандарты сервиса салона «Лик 28».');

  return {
    transcript_summary: summary,
    booking_status: bookingStatus,
    formatted_transcript: formattedTranscript,
    key_facts: {
      is_dispute: isAutoOrFailed ? false : Boolean(parsed.key_facts?.is_dispute),
      dispute_reason: isAutoOrFailed ? null : (parsed.key_facts?.dispute_reason || null),
      tone_client: isAutoOrFailed ? 'нейтральный' : (parsed.key_facts?.tone_client || 'нейтральный'),
      tone_manager: isAutoOrFailed ? 'нейтральный' : (parsed.key_facts?.tone_manager || 'нейтральный'),
      call_outcome: outcome,
      booking_status: bookingStatus,
      client_issue: isAutoOrFailed ? 'Несостоявшийся вызов / автоответчик' : (parsed.key_facts?.client_issue || 'Обращение в салон «Лик 28»'),
    },
    operator_score: score,
    operator_comment: comment,
    recommendations: recommendations,
  };
}

function generateLocalFallbackAnalysis(
  transcript: string,
  model: GigaChatModel,
  callDurationSeconds?: number
): AnalysisResult {
  const clean = (transcript || '').trim();
  const lower = clean.toLowerCase();

  // 1. Strict guard: calls under 10 seconds or zero-duration
  if (callDurationSeconds !== undefined && callDurationSeconds < 10) {
    return {
      transcript_summary: `Разговор не состоялся: длительность вызова ${callDurationSeconds} сек (менее 10 секунд), диалог между оператором и клиентом отсутствует.`,
      booking_status: 'не применимо',
      formatted_transcript: clean || 'Разговор не состоялся (длительность менее 10 сек, диалог отсутствует).',
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'не состоялся',
        booking_status: 'не применимо',
        client_issue: 'Звонок менее 10 секунд / диалог отсутствует',
      },
      operator_score: null,
      operator_comment: `Оценка не выставляется: разговор не состоялся (длительность ${callDurationSeconds} сек менее 10 секунд, диалог отсутствует).`,
      recommendations: 'При необходимости повторить попытку дозвона клиенту.',
    };
  }

  // 2. Empty or placeholder transcript (awaiting or missing STT)
  const isPlaceholderOrEmpty = !clean ||
    lower.includes('стенограмма ожидает') ||
    lower.includes('запись разговора и стенограмма отсутствуют') ||
    lower.includes('разговор не состоялся');

  if (isPlaceholderOrEmpty) {
    const durLabel = callDurationSeconds !== undefined ? ` (длительность ${callDurationSeconds} сек.)` : '';
    return {
      transcript_summary: `Разговор не состоялся: аудиозапись${durLabel} не содержит разборчивой речи (зафиксированы только гудки/тишина или сброс линии).`,
      booking_status: 'не применимо',
      formatted_transcript: clean || `Аудиозапись${durLabel} не содержит разборчивой речи.`,
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'не состоялся',
        booking_status: 'не применимо',
        client_issue: 'Отсутствует разборчивая речь в аудиозаписи',
      },
      operator_score: null,
      operator_comment: `Оценка не выставляется: аудиозапись${durLabel} не содержит разборчивого диалога оператора и клиента.`,
      recommendations: 'Проверить качество связи или повторить вызов.',
    };
  }

  // 3. Pure voicemail/answering machine ONLY if there is NO real conversation
  const hasDialogue = (lower.includes('клиент:') && (lower.includes('менеджер:') || lower.includes('администратор:'))) ||
    clean.split('\n').filter(l => l.trim().length > 0).length >= 2;

  const isPureAuto = !hasDialogue && (
    lower.includes('оставьте сообщение после сигнала') ||
    lower.includes('вас приветствует автоответчик') ||
    lower.includes('абонент временно недоступен') ||
    lower.includes('голосовая почта') ||
    lower.includes('автоинформатор')
  );
  
  if (isPureAuto) {
    return {
      transcript_summary: 'Разговор не состоялся: сработал автоответчик или голосовая почта. Запись не оформлена.',
      booking_status: 'не применимо',
      formatted_transcript: clean,
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
      operator_comment: 'Разговор не состоялся: зафиксирован автоответчик (оценка не выставляется).',
      recommendations: 'Повторить звонок клиенту в рабочие часы салона «Лик 28».',
    };
  }

  // 4. Genuine call with speech (from 10 seconds to 1 minute or longer)
  // Strict rule: NEVER claim "длительность менее 10 секунд" if call was >= 10s!
  const isDispute = lower.includes('отмен') || lower.includes('жалоб') || lower.includes('претензи') || lower.includes('недоволен') || lower.includes('издеваетесь');
  const isDeclined = lower.includes('не будет в городе') || lower.includes('не смогу') || lower.includes('не получается') || lower.includes('неудобно') || lower.includes('не подходит') || lower.includes('отказ');
  
  // Comprehensive Russian salon booking confirmation & consent recognition
  const isBooking = !isDeclined && (
    lower.includes('записали') || lower.includes('записала') || lower.includes('записал') ||
    lower.includes('записываю') || lower.includes('записан') || lower.includes('записана') || lower.includes('записаны') ||
    lower.includes('запишите') || lower.includes('запись оформлена') || lower.includes('запись подтверждена') ||
    lower.includes('до встречи') || lower.includes('ждем вас') || lower.includes('ждём вас') ||
    lower.includes('ждем') || lower.includes('ждём') || lower.includes('жду вас') || lower.includes('будем ждать') ||
    lower.includes('договорились') || lower.includes('согласна') || lower.includes('согласен') ||
    lower.includes('буду к') || lower.includes('буду в') || lower.includes('приду в') || lower.includes('приду к') ||
    lower.includes('подходит время') || lower.includes('подходит этот день') || lower.includes('подтверждаю запись')
  );

  const outcome = isBooking ? 'запись' : (isDeclined ? 'отказ' : (isDispute ? 'перезвон' : 'консультация'));
  const bookingStatus = isBooking ? 'согласие' : (isDeclined ? 'отказ' : (isDispute ? 'консультация' : 'консультация'));

  // Derive factual summary without inventing fantasy details
  const cleanSnippet = clean.replace(/^(клиент:|менеджер:|администратор:)\s*/gim, '').trim().slice(0, 160);
  const durPrefix = callDurationSeconds !== undefined ? `[${callDurationSeconds} сек.] ` : '';

  let summaryText = '';
  if (isBooking) {
    summaryText = `${durPrefix}Клиент обратился в салон «Лик 28». Достигнута договоренность о записи на услуги. Статус: согласие.`;
  } else if (isDeclined) {
    summaryText = `${durPrefix}Клиент обратился в салон «Лик 28», но предложенное время не подошло. Статус: отказ от записи.`;
  } else if (isDispute) {
    summaryText = `${durPrefix}Обращение клиента с вопросом/претензией по обслуживанию. Требуется перезвон.`;
  } else {
    summaryText = `${durPrefix}Короткий диалог / консультация: «${cleanSnippet}»`;
  }

  const score = hasDialogue ? (isDispute ? 7 : 9) : null;
  const comment = hasDialogue
    ? (isDispute ? 'Администратор принял претензию/отмену, соблюдая вежливый тон.' : 'Администратор вежливо проконсультировал клиента по регламенту «Лик 28».')
    : 'Краткий обмен репликами. Полноценная оценка регламента не выставляется.';

  return {
    transcript_summary: summaryText,
    booking_status: bookingStatus,
    formatted_transcript: transcript,
    key_facts: {
      is_dispute: isDispute,
      dispute_reason: isDispute ? 'Претензия или отмена записи' : null,
      tone_client: isDispute ? 'негативный' : 'нейтральный',
      tone_manager: 'позитивный',
      call_outcome: outcome,
      booking_status: bookingStatus,
      client_issue: isDispute ? 'Вопрос по обслуживанию' : 'Консультация / обращение в салон',
    },
    operator_score: score,
    operator_comment: comment,
    recommendations: 'Соблюдать стандарты сервиса и вежливого общения салона «Лик 28».',
  };
}
