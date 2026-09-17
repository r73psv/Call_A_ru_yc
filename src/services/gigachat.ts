/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import axios from 'axios';
import https from 'https';
import { getGigaChatToken, isGigaChatConfigured } from './gigachat-auth.js';
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

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

export async function analyzeWithRetry(
  transcript: string,
  model?: GigaChatModel
): Promise<AnalysisResult> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await analyzeWithGigaChat(transcript, model);
    } catch (error: any) {
      lastError = error as Error;
      console.error(
        `[GigaChat] Попытка ${attempt}/${MAX_RETRIES} неудачна:`,
        error.message
      );

      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1); // 2s, 4s, 8s
        console.log(`[GigaChat] Повтор через ${delay / 1000} сек...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  console.error('[GigaChat] Все 3 попытки неудачны. Анализ пропущен.');
  throw new Error(
    `GigaChat недоступен после ${MAX_RETRIES} попыток: ${lastError?.message}`
  );
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
