/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';
import { CallRecord, LogEntry, SystemConfig, ModelType, DashboardStats, KeyFacts, VkConfig, YclientsConfig, GigaChatModel, SystemNotification, NotificationType, UserRole } from './src/types.js';
import { transcribeWithRetry, fixDuplicatedTranscript, refineTranscriptRoles } from './src/services/speechkit.js';
import { transcribeAudio } from './src/services/transcriptionService.js';
import { analyzeWithRetry, getGigaChatQueueStatus } from './src/services/gigachat.js';
import { anonymizeTranscript, maskPhone } from './src/services/anonymize.js';
import { readStoreSync, writeStore } from './src/store/store.js';
import { readConsentStoreSync, writeConsentStore } from './src/store/consent-store.js';
import { ensureAutoConsent, getConsentForPhone, registerConsent, syncConsentsFromCalls } from './src/store/consents.js';
import { initCleanupScheduler, runCleanupNow } from './src/store/cleanup.js';
import { consentsRouter } from './src/routes/consents.js';
import { settingsRouter } from './src/routes/settings.js';
import { authRouter, adminUsersRouter, getCurrentUserRole, getCurrentUser } from './src/routes/auth.js';
import { adminRouter } from './src/routes/admin.js';
import { isYandexAuthConfigured } from './src/services/yandex-auth.js';
import { isGigaChatConfigured } from './src/services/gigachat-auth.js';
import { hydrateFromS3, scheduleSyncToS3, manualSync, getSyncStatus } from './src/services/s3-sync.js';
import { generateCallAuditPdf, generatePeriodStatsPdf, PeriodStatsReportData } from './src/services/pdfReport.js';
import { generateCallCsv } from './src/services/csvExport.js';

// Setup environment variables
dotenv.config();

// Ensure compatibility with Russian domestic TLS certificates (Минцифры / Megafon / GigaChat)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const resolvedDirname = typeof __dirname !== 'undefined' ? __dirname : process.cwd();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Auth & Admin Routers
app.use('/api/auth', authRouter);
app.use('/api/admin/users', adminUsersRouter);
app.use('/api/admin', adminRouter);

// 152-ФЗ Consents and Settings Routers
app.use('/api/consents', consentsRouter);
app.use('/api/settings', settingsRouter);

// Paths
const DATA_FILE = process.env.DATA_PATH || path.join(process.cwd(), 'data', 'data-store.json');
const SEED_FILE = path.join(process.cwd(), 'data-store.seed.json');
const FALLBACK_FILE = path.join(process.cwd(), 'data-store.json');
const DIST_PATH = path.join(process.cwd(), 'dist');

// Unified helper to construct full encrypted snapshot for S3 timeweb.cloud
function getFullDataForSync() {
  const db = readStoreSync();
  const consentStore = readConsentStoreSync();
  return {
    calls: db.calls || [],
    logs: db.logs || [],
    config: db.config || {},
    users: db.users || [],
    consents: consentStore.consents || [],
    access_log: db.access_log || []
  };
}

// Local Database initialization
const DEFAULT_CONFIG: SystemConfig = {
  activeModel: 'GigaChat:Lite',
  default_gigachat_model: 'GigaChat:Lite',
  megafon: {
    token: 'megafon_ats_auth_token_example_123',
    webhookUrl: '/api/calls/webhook',
    autoImport: true,
    active: true,
    pollingEnabled: false,
    pollingIntervalMinutes: 5,
    lastPollingTime: new Date(Date.now() - 12 * 3600000).toISOString() // 12 hours ago
  },
  vk: {
    token: 'vk_group_api_token_example_xyz',
    chatId: '2000000045',
    enabled: true,
    template: `🔔 *Анализ звонка #{call_id}*\n📅 *Дата и время (UTC+4):* {call_date_time}\n⏱️ *Длительность:* {duration}\n\n👤 *Клиент:* {client_name}\n📞 *Оценка оператора:* {operator_score}\n💬 *Резюме:* {summary}\n⚠️ *Конфликт:* {is_dispute_text} ({dispute_reason})\n📋 *Обещания менеджера:* {promises}\n💡 *Рекомендации:* {recommendations}`
  },
  yclients: {
    userToken: 'yclients_user_token_example_777',
    partnerToken: 'yclients_partner_token_example_888',
    salonId: '987654',
    enabled: true
  }
};

const DEFAULT_LOGS: LogEntry[] = [
  {
    id: 'log-1',
    timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
    type: 'info',
    module: 'system',
    message: 'Сервер аналитики звонков успешно запущен'
  },
  {
    id: 'log-2',
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    type: 'info',
    module: 'megafon',
    message: 'Интеграция с АТС Мегафон активна. Ожидание входящих вебхуков по адресу /api/calls/webhook'
  }
];

const SEED_CALLS: CallRecord[] = [
  {
    call_id: 'megafon-call-89101',
    timestamp: new Date(Date.now() - 3600000 * 4).toISOString(),
    duration_seconds: 145,
    model_used: 'GigaChat:Lite',
    audio_url: 'https://cp.megafon.ru/record/megafon-call-89101.mp3',
    client_name: 'Елена Кузнецова (3344)',
    operator_name: 'Мария (администратор)',
    status: 'completed',
    is_demo: true,
    transcript: `Менеджер: Добрый день! Салон красоты "Лик 28", меня зовут Мария. Чем я могу вам помочь?\nКлиент: Здравствуйте. Я бы хотела записаться на аппаратный маникюр с покрытием шеллак на завтра на вечер.\nМенеджер: Да, конечно, Елена. Завтра на вечер есть свободное время на 18:30 и на 20:00. Какой мастер вам больше нравится — Кристина или Анна?\nКлиент: Давайте к Кристине на 18:30. Сколько это будет стоить?\nМенеджер: Аппаратный маникюр с покрытием у Кристины стоит 2100 рублей. По времени займет около полутора часов. Записываю вас на завтра на 18:30.\nКлиент: Отлично, спасибо большое!\nМенеджер: Пожалуйста! За полчаса до визита мы пришлем вам напоминание в WhatsApp. Ждем вас!`,
    summary: 'Клиент Елена Кузнецова обратилась для записи на аппаратный маникюр с покрытием шеллак на завтрашний вечер. Администратор Мария оперативно предложила свободное время и уточнила предпочтения по мастерам. Разговор завершился успешной записью на 18:30 к мастеру Кристине.',
    key_facts: {
      is_dispute: false,
      dispute_reason: null,
      promises: ['Прислать напоминание в WhatsApp за полчаса до визита'],
      tone_client: 'нейтральный',
      tone_manager: 'спокойный',
      call_outcome: 'успешно',
      client_issue: 'Запись на маникюр'
    },
    trigger_phrases: [],
    recommendations: [
      'Отличная работа оператора, вежливость на высоком уровне.',
      'Рекомендуется также предложить клиенту сопутствующие услуги, например, парафинотерапию.'
    ],
    operator_score: 10,
    operator_comment: 'Мария продемонстрировала отличные навыки вежливого общения, быстро ответила на вопросы по цене и длительности, зафиксировала договоренности и пообещала напоминание.'
  },
  {
    call_id: 'megafon-call-89102',
    timestamp: new Date(Date.now() - 3600000 * 3).toISOString(),
    duration_seconds: 180,
    model_used: 'GigaChat:Lite',
    audio_url: 'https://cp.megafon.ru/record/megafon-call-89102.mp3',
    client_name: 'Анна Васильева (6677)',
    operator_name: 'Дмитрий (менеджер)',
    status: 'completed',
    is_demo: true,
    transcript: `Клиент: Здравствуйте! Мне пришло сообщение, что моя запись к косметологу на сегодня отменена! Вы издеваетесь? Я уже еду к вам!\nМенеджер: Здравствуйте! Приносим свои глубочайшие извинения. Дело в том, что мастер экстренно заболел, и мы физически не можем провести процедуру прямо сейчас.\nКлиент: Я уже второй раз к вам записываюсь, и вы вечно отменяете! Мне это абсолютно не подходит! Я трачу свое время на дорогу!\nМенеджер: Мы прекрасно вас понимаем и искренне сожалеем. Давайте мы подберем вам другого топ-мастера на удобное время со скидкой 30% на процедуру в качестве компенсации?\nКлиент: Ладно. А когда есть свободное время у другого мастера?\nМенеджер: Завтра в 12:00 или в 15:00 есть окна у Ирины, она ведущий специалист. И мы сделаем вам скидку.\nКлиент: Хорошо, давайте завтра на 12:00 к Ирине.\nМенеджер: Отлично, записала вас на завтра на 12:00 к Ирине. Мы перезвоним вам сегодня вечером, чтобы подтвердить, что все в силе, и зафиксируем скидку 30%. Еще раз извините за неудобства.`,
    summary: 'Клиент Анна Васильева позвонила в негодовании из-за отмены ее записи к косметологу день-в-день. Менеджер Дмитрий извинился, объяснил причину (болезнь мастера) и сгладил конфликт, предложив другого мастера со скидкой 30%. Клиентка согласилась перенести визит на завтра.',
    key_facts: {
      is_dispute: true,
      dispute_reason: 'Клиент недоволен отменой записи день-в-день',
      promises: ['Предоставить скидку 30% на процедуру у косметолога Ирины', 'Перезвонить сегодня вечером для подтверждения записи'],
      tone_client: 'недовольный',
      tone_manager: 'спокойный',
      call_outcome: 'перенесён',
      client_issue: 'Отмена записи день-в-день'
    },
    trigger_phrases: [
      'Вы издеваетесь? Я уже еду к вам!',
      'Я уже второй раз к вам записываюсь, и вы вечно отменяете!',
      'Мне это абсолютно не подходит! Я трачу свое время на дорогу!'
    ],
    recommendations: [
      'Менеджер хорошо справился со снижением градуса конфликта с помощью скидки.',
      'В будущем следует уведомлять клиентов об отменах минимум за 3-4 часа, чтобы избежать подобных инцидентов.'
    ],
    operator_score: 8,
    operator_comment: 'Дмитрий был спокоен, не перебивал клиента, применил технику амортизации и быстро предложил решение с компенсацией в виде скидки 30%. Упущен 1 балл из-за того, что звонок не был совершен проактивно до выезда клиента.'
  }
];

// Helper to read database (Encrypted AES-256-GCM via 152-ФЗ store)
function readDb() {
  return readStoreSync();
}

// Helper to write database (Encrypted AES-256-GCM via 152-ФЗ store)
function writeDb(data: any) {
  try {
    writeStore(data).catch(err => console.error('[Encrypted Store Write Error]', err));
    scheduleSyncToS3(getFullDataForSync);
  } catch (err) {
    console.error('Error writing database file:', err);
  }
}

// Helper to append a system log
function appendLog(
  type: LogEntry['type'],
  module: LogEntry['module'],
  message: string,
  details?: string
) {
  const db = readDb();
  const newLog: LogEntry = {
    id: `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    timestamp: new Date().toISOString(),
    type,
    module,
    message,
    details
  };
  db.logs.unshift(newLog);
  // Keep last 150 logs
  if (db.logs.length > 150) {
    db.logs = db.logs.slice(0, 150);
  }
  writeDb(db);
  return newLog;
}

// Real-time SSE Clients registry for Toast notifications (Admins & Managers)
interface SseNotificationClient {
  id: string;
  role: UserRole;
  res: express.Response;
}
const sseNotificationClients = new Map<string, SseNotificationClient>();

function broadcastNotification(notification: SystemNotification) {
  const data = JSON.stringify(notification);
  for (const [clientId, client] of sseNotificationClients.entries()) {
    // Deliver toasts strictly to admins and managers per requirement
    if (client.role === 'admin' || client.role === 'manager') {
      try {
        client.res.write(`event: notification\ndata: ${data}\n\n`);
      } catch (err) {
        sseNotificationClients.delete(clientId);
      }
    }
  }
}

// Generate, persist, and broadcast Toast Notification when a call is analyzed
function notifyCallAnalyzed(call: CallRecord): SystemNotification {
  const db = readDb();
  if (!Array.isArray(db.notifications)) {
    db.notifications = [];
  }

  const isDispute = !!call.key_facts?.is_dispute;
  const isBooked = call.booking_status === 'согласие' || call.key_facts?.call_outcome === 'запись';
  const isFailed = call.status === 'failed';
  const isMissed = call.status === 'missed';

  let type: NotificationType = 'call_analyzed';
  let title = 'Завершен анализ звонка';
  if (isDispute) {
    type = 'dispute_detected';
    title = '⚠️ Зафиксирован спор в диалоге';
  } else if (isBooked) {
    type = 'booking_confirmed';
    title = '✓ Успешная запись клиента';
  } else if (isFailed) {
    type = 'call_failed';
    title = '✕ Ошибка обработки звонка';
  } else if (isMissed) {
    type = 'call_analyzed';
    title = '📞 Пропущенный вызов';
  }

  const message = call.summary || (isFailed ? 'Не удалось выполнить транскрибацию или анализ' : 'Диалог проанализирован');

  const notif: SystemNotification = {
    id: `notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    call_id: call.call_id,
    timestamp: new Date().toISOString(),
    type,
    title,
    message,
    client_name: call.client_name || 'Клиент',
    client_phone_masked: call.client_phone_masked,
    operator_name: call.operator_name || 'Оператор',
    operator_score: call.operator_score,
    booking_status: call.booking_status || call.key_facts?.booking_status,
    is_dispute: isDispute,
    duration_seconds: call.duration_seconds,
    model_used: call.model_used,
    read: false
  };

  db.notifications.unshift(notif);
  if (db.notifications.length > 150) {
    db.notifications = db.notifications.slice(0, 150);
  }
  writeDb(db);

  broadcastNotification(notif);
  appendLog('info', 'system', `Всплывающее оповещение для менеджеров: [${call.call_id}] ${title} (${call.client_name || 'Клиент'})`);
  return notif;
}

// Helper function to normalize and fix salon brand name spelling variants
function normalizeSalonNames(text: string): string {
  if (!text || typeof text !== 'string') return text;
  
  let result = text
    // Replace erroneous variants like "Ликс 28", "Ликс28", "Лик28", "Лик-28", "Лик двадцать восемь", "Лайк 28", "Лайк28", "Лиг 28", "Элик 28"
    .replace(/(?:салон(?:а|е|у|ом|ы)?\s+красоты\s+)?(?:\bлик(?:с|з)?\s*28\b|\bлик(?:с|з)?28\b|\bлик-28\b|\bлик\s+двадцать\s+восемь\b|\bлайк\s*28\b|\bлиг\s*28\b|\bэлик\s*28\b)/gi, (match) => {
      const lower = match.toLowerCase();
      if (lower.includes('салон')) {
        if (lower.includes('салона')) return 'салона красоты «Лик 28»';
        if (lower.includes('салоне')) return 'салоне красоты «Лик 28»';
        if (lower.includes('салону')) return 'салону красоты «Лик 28»';
        if (lower.includes('салоном')) return 'салоном красоты «Лик 28»';
        return 'салон красоты «Лик 28»';
      }
      return '«Лик 28»';
    })
    .replace(/\bЛикс\s*28\b/gi, 'Лик 28')
    .replace(/\bЛикс28\b/gi, 'Лик 28')
    .replace(/\bЛик28\b/gi, 'Лик 28')
    .replace(/\bЛайк\s*28\b/gi, 'Лик 28')
    .replace(/\bЛик двадцать восемь\b/gi, 'Лик 28');

  // Remove false-positive criticisms where AI hallucinates that "Лик 28" is an incorrect name
  result = result
    .replace(/озвучила наименование салона [«"]Лик 28[»"] вместо регламентированного [«"][^»"]+[»"]/gi, 'озвучила регламентированное наименование салона «Лик 28»')
    .replace(/назвала салон [«"]Лик 28[»"] вместо регламентированного [«"][^»"]+[»"]/gi, 'назвала регламентированное наименование салона «Лик 28»')
    .replace(/Проверить соответствие приветствия стандартам бренда [«"]Лик 28[»"] \(администратор назвала салон [«"]Лик 28[»"]\)\.?/gi, '')
    .replace(/Если бренд изменился или это партнерская сеть, необходимо строго следовать единому речевому стандарту\.?/gi, '');

  return result;
}

// Helper function to detect and sanitize auto-responder/voicemail/busy line hallucinations or invalid empty analyses
function sanitizeAnalysisResults(parsed: Partial<CallRecord>, transcriptInput?: string): Partial<CallRecord> {
  if (!parsed) return parsed;

  const rawTranscript = (parsed.transcript || transcriptInput || '').toLowerCase();
  const summary = (parsed.summary || '').toLowerCase();
  const comment = (parsed.operator_comment || '').toLowerCase();

  // Auto-responder / Voicemail / Answering Machine / System voice / Busy line indicators
  const autoResponderKeywords = [
    'абонент сейчас не может ответить',
    'абонент временно недоступен',
    'попробуйте перезвонить поднее',
    'попробуйте перезвонить позже',
    'перезвоните позднее',
    'перезвоните позже',
    'оставьте сообщение после сигнала',
    'звуковой сигнал',
    'сработал автоответчик',
    'вас приветствует автоответчик',
    'автоответчик:',
    'автоинформатор',
    'автоинформатора',
    'системное сообщение',
    'неправильно набран номер',
    'аппарат абонента выключен',
    'линия занята',
    'абонент занят',
    'привет, линия занята',
    'занято',
    'номер занят',
    'все операторы заняты',
    'все линии заняты',
    'линия недоступна',
    'короткие гудки',
    'сброс звонка',
    'вызов завершен'
  ];

  let isAutoResponder = false;
  for (const kw of autoResponderKeywords) {
    if (rawTranscript.includes(kw) || summary.includes(kw) || comment.includes(kw)) {
      isAutoResponder = true;
      break;
    }
  }

  // Detect hallucinated order/service conversation ONLY when transcript is actually an explicit auto-responder and has no dialog
  const cleanT = (parsed.transcript || transcriptInput || '').trim();
  const cleanTLower = cleanT.toLowerCase();
  
  // Check if transcript contains dialogue:
  const hasHumanDialog = (cleanTLower.includes('клиент:') || cleanTLower.includes('покупатель:') || cleanTLower.includes('абонент:')) ||
                         (cleanTLower.includes('менеджер:') || cleanTLower.includes('администратор:') || cleanTLower.includes('оператор:'));

  const isExplicitAnsweringMachine = 
    rawTranscript.includes('оставьте сообщение') ||
    rawTranscript.includes('абонент не может ответить') ||
    rawTranscript.includes('абонент временно недоступен') ||
    rawTranscript.includes('привет, линия занята') ||
    (rawTranscript.includes('номер занят') && cleanT.length < 80);

  if (isExplicitAnsweringMachine && cleanT.length < 120 && !hasHumanDialog) {
    let actualText = parsed.transcript && parsed.transcript !== 'Аудиозапись телефонного разговора.'
      ? parsed.transcript
      : (transcriptInput || 'Привет, линия занята');

    if (rawTranscript.includes('линия занята') || rawTranscript.includes('занято')) {
      actualText = 'Система: Привет, линия занята';
    } else if (!actualText.startsWith('Автоответчик:') && !actualText.startsWith('Система:')) {
      actualText = `Автоответчик: ${actualText}`;
    }

    console.log(`[Фильтр Галлюцинаций] Выявлен автоответчик/занятая линия/короткий системный вызов (${cleanT.length} симв.). Применена очистка от галлюцинаций.`);

    return {
      ...parsed,
      transcript: actualText,
      summary: `Разговор не состоялся: на линии занято, сработал автоответчик или системный автоинформатор.`,
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        promises: [],
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'занято / автоответчик',
        client_issue: 'Занято / Автоответчик / Короткий вызов'
      },
      trigger_phrases: [],
      operator_score: null,
      operator_comment: 'Разговор с клиентом не состоялся: на линии занято или сработал автоответчик. Оценка оператора не выставляется.',
      recommendations: ['Повторить попытку вызова клиенту позже.']
    };
  }

  // Normalize salon brand name in all generated fields
  const normalized: Partial<CallRecord> = {
    ...parsed,
    transcript: parsed.transcript ? normalizeSalonNames(parsed.transcript) : parsed.transcript,
    summary: parsed.summary ? normalizeSalonNames(parsed.summary) : parsed.summary,
    operator_comment: parsed.operator_comment ? normalizeSalonNames(parsed.operator_comment) : parsed.operator_comment,
    recommendations: Array.isArray(parsed.recommendations)
      ? parsed.recommendations.map(r => normalizeSalonNames(r)).filter(r => r && r.trim().length > 0)
      : parsed.recommendations,
    trigger_phrases: Array.isArray(parsed.trigger_phrases)
      ? parsed.trigger_phrases.map(t => normalizeSalonNames(t))
      : parsed.trigger_phrases
  };

  if (normalized.key_facts) {
    normalized.key_facts = {
      ...normalized.key_facts,
      client_issue: normalized.key_facts.client_issue ? normalizeSalonNames(normalized.key_facts.client_issue) : normalized.key_facts.client_issue,
      promises: Array.isArray(normalized.key_facts.promises) ? normalized.key_facts.promises.map(p => normalizeSalonNames(p)) : normalized.key_facts.promises
    };
  }

  return normalized;
}

// Robust helper function to extract and parse JSON from LLM responses safely
function extractAndParseLLMJson(rawText: string, transcriptInput: string, moduleName: string): Partial<CallRecord> {
  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
    appendLog('warning', moduleName as any, 'ИИ вернул пустой ответ. Применена резервная аналитика.');
    return getFallbackAnalysis(transcriptInput, 'Пустой ответ от ИИ модели');
  }

  const trimmed = rawText.trim();

  // 1. Try direct JSON parse first
  try {
    const directParsed = JSON.parse(trimmed);
    if (typeof directParsed === 'object' && directParsed !== null && (directParsed.transcript || directParsed.summary || directParsed.key_facts)) {
      return sanitizeAnalysisResults(directParsed, transcriptInput);
    }
  } catch {
    // Proceed to extraction strategies
  }

  // 2. Extract from markdown code fences ```json ... ``` or ``` ... ```
  let candidate = trimmed;
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch && fenceMatch[1]) {
    candidate = fenceMatch[1].trim();
  }

  // 3. Extract content between first '{' and last '}'
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    candidate = candidate.substring(firstBrace, lastBrace + 1);
  }

  try {
    const parsed = JSON.parse(candidate);
    if (typeof parsed === 'object' && parsed !== null) {
      return sanitizeAnalysisResults(parsed, transcriptInput);
    }
  } catch {
    // Attempt cleaning trailing commas or control characters
    try {
      const sanitized = candidate
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
      const parsedSanitized = JSON.parse(sanitized);
      if (typeof parsedSanitized === 'object' && parsedSanitized !== null) {
        return sanitizeAnalysisResults(parsedSanitized, transcriptInput);
      }
    } catch {
      // Ignore
    }
  }

  // 4. Fallback if LLM returned plain text instead of JSON (e.g., conversational replies or refusals)
  const lowerRaw = rawText.toLowerCase();
  const isRefusal = 
    lowerRaw.includes('предоставьте аудиозапись') ||
    lowerRaw.includes('предоставьте текст') ||
    lowerRaw.includes('без исходных данных') ||
    lowerRaw.includes('не могу сформировать json') ||
    lowerRaw.includes('не могу выполнить анализ') ||
    lowerRaw.includes('не предоставлен текст') ||
    lowerRaw.includes('не предоставлена аудиозапись') ||
    lowerRaw.includes('отсутствует текст') ||
    lowerRaw.includes('нет данных для анализа') ||
    lowerRaw.includes('пришлите текст') ||
    lowerRaw.includes('пришлите аудио') ||
    lowerRaw.includes('пожалуйста, предоставьте') ||
    lowerRaw.includes('исходные данные не предоставлены');

  if (isRefusal) {
    appendLog('error', moduleName as any, `ИИ вернул отказ из-за отсутствия исходных данных диалога: ${rawText.substring(0, 120)}...`);
    return getFallbackAnalysis(transcriptInput, `Модель ИИ запросила исходные данные: ${rawText.substring(0, 180)}`);
  }

  appendLog('warning', moduleName as any, `ИИ вернул ответ в виде неструктурированного текста.`);
  return getFallbackAnalysis(transcriptInput, `ИИ вернул неструктурированный текст вместо JSON: ${rawText.substring(0, 150)}`);
}

// В приложении используются исключительно российские модели (Сбер GigaChat, Yandex Cloud)

// Helper to check if a call record failed due to technical/limitation error and needs reanalysis
function isTechnicalFailedCall(call: any): boolean {
  if (!call) return false;
  // If call duration is 0 or it is a missed call, it is NOT a technical failure — it was not answered.
  if (call.duration_seconds === 0 || call.is_answered === false || call.status === 'missed') {
    return false;
  }

  // Prevent endless retry loops: limit to max 2 retries and 2 hours cooldown
  const retryCount = call.retry_count || 0;
  if (retryCount >= 2) {
    return false;
  }

  if (call.last_retry_at) {
    const lastRetryMs = new Date(call.last_retry_at).getTime();
    if (Date.now() - lastRetryMs < 7200000) { // 2 hours cooldown between retries
      return false;
    }
  }

  if (call.status === 'failed' || call.status === 'error') {
    return true;
  }
  const transcript = (call.transcript || '').toLowerCase();
  const summary = (call.summary || '').toLowerCase();
  const comment = (call.operator_comment || '').toLowerCase();

  const failureTerms = [
    'исчерпан лимит',
    'превышена квота',
    'лимит токенов',
    'не удавалось скачать',
    'не удалось скачать',
    'отсутствует ключ',
    'ошибка ии-анализа',
    'анализ звонка заблокирован из-за ошибки',
    'загрузка аудиозаписи...',
    'обработка аудио...',
    'аудиозапись не была загружена',
    'стенограмма отсутствует',
    'запись разговора и стенограмма отсутствуют',
    'технической причине',
    'ошибка вызова',
    'ошибка во время анализа',
    'предоставьте аудиозапись',
    'без исходных данных',
    'не могу сформировать json'
  ];

  for (const term of failureTerms) {
    if (transcript.includes(term) || summary.includes(term) || comment.includes(term)) {
      return true;
    }
  }

  if (!call.transcript || call.transcript.trim().length < 10) {
    return true;
  }

  return false;
}

// Helper to inspect parsed result for technical failure markers
function isTechnicalErrorResult(res: Partial<CallRecord>): boolean {
  if (!res) return true;
  const transcript = (res.transcript || '').toLowerCase();
  const summary = (res.summary || '').toLowerCase();
  const comment = (res.operator_comment || '').toLowerCase();

  const errTerms = [
    'исчерпан лимит',
    'превышена квота',
    'лимит токенов',
    'не удавалось скачать',
    'отсутствует ключ',
    'ошибка ии-анализа',
    'анализ звонка заблокирован из-за ошибки',
    'отсутствует api ключ',
    'ошибка вызова',
    'таймаут подключения',
    'http 4',
    'http 5',
    'предоставьте аудиозапись',
    'без исходных данных',
    'не могу сформировать json',
    'запросила исходные данные'
  ];

  for (const term of errTerms) {
    if (transcript.includes(term) || summary.includes(term) || comment.includes(term)) {
      return true;
    }
  }
  return false;
}

// Single model call attempt with GigaChat & 152-ФЗ Anonymization
async function executeSingleModelAttempt(
  model: ModelType | GigaChatModel,
  cleanTranscript: string,
  _audioBase64?: { data: string; mimeType: string }
): Promise<{ success: boolean; result?: Partial<CallRecord>; errorReason?: string }> {
  try {
    const anonymizedText = anonymizeTranscript(cleanTranscript);
    let gigaModel: GigaChatModel = 'GigaChat:Lite';
    if (model === 'GigaChat:Pro' || model === 'GigaChat:Max' || model === 'GigaChat:Lite' || model === 'GigaChat:Ultra') {
      gigaModel = model;
    }
    appendLog('info', 'gigachat', `Отправка запроса на анализ в модель ${gigaModel}...`);
    const analysis = await analyzeWithRetry(anonymizedText, gigaModel, (type, msg) => appendLog(type, 'gigachat', msg));
    appendLog('success', 'gigachat', `Звонок успешно проанализирован моделью ${gigaModel}.`);
    return {
      success: true,
      result: {
        transcript: analysis.formatted_transcript || cleanTranscript,
        summary: analysis.transcript_summary,
        booking_status: analysis.booking_status || analysis.key_facts?.booking_status,
        key_facts: {
          ...analysis.key_facts,
          booking_status: analysis.booking_status || analysis.key_facts?.booking_status,
          promises: []
        },
        trigger_phrases: [],
        recommendations: Array.isArray(analysis.recommendations) ? analysis.recommendations : [analysis.recommendations],
        operator_score: analysis.operator_score,
        operator_comment: analysis.operator_comment,
        model_used: gigaModel
      }
    };
  } catch (err: any) {
    appendLog('error', 'gigachat', `Ошибка вызова ИИ: ${err.message}`);
    return { success: false, errorReason: err.message || String(err) };
  }
}

// Unified Yandex SpeechKit STT + Sber GigaChat LLM Calling Logic with 152-ФЗ Anonymization
async function analyzeCallTextOrAudio(
  requestedModel: string,
  transcriptInput: string,
  audioBase64?: { data: string; mimeType: string },
  audioDownloadFailed: boolean = false,
  callDurationSeconds?: number
): Promise<Partial<CallRecord>> {
  let cleanTranscript = (transcriptInput || '').trim();

  // 0. Strict check: calls under 10 seconds MUST NOT hallucinate dialogue or receive scores
  if (callDurationSeconds !== undefined && callDurationSeconds < 10) {
    appendLog('info', 'megafon', `Звонок длительностью ${callDurationSeconds} сек (<10 сек): анализ ИИ пропущен, оценка оператора не выставляется.`);
    return {
      transcript: cleanTranscript || 'Разговор не состоялся (длительность менее 10 сек, диалог отсутствует).',
      summary: `Разговор не состоялся: длительность вызова ${callDurationSeconds} сек (менее 10 секунд), диалог между оператором и клиентом отсутствует.`,
      booking_status: 'не применимо',
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        promises: [],
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'не состоялся',
        booking_status: 'не применимо',
        client_issue: 'Звонок менее 10 секунд / диалог отсутствует'
      },
      trigger_phrases: [],
      recommendations: ['При необходимости связаться с клиентом повторно.'],
      operator_score: null,
      operator_comment: `Оценка не выставляется: разговор не состоялся (длительность ${callDurationSeconds} сек менее 10 секунд, диалог отсутствует).`
    };
  }

  const isInvalidOrErrorTranscript =
    !cleanTranscript ||
    cleanTranscript === 'Загрузка аудиозаписи...' ||
    cleanTranscript === 'Обработка аудио...' ||
    cleanTranscript.startsWith('Аудиозапись не была') ||
    cleanTranscript.startsWith('Стенограмма отсутствует') ||
    cleanTranscript.includes('не содержит разборчивой речи') ||
    cleanTranscript.includes('Стенограмма ожидает') ||
    cleanTranscript.includes('не была загружена') ||
    cleanTranscript.includes('исчерпан лимит') ||
    cleanTranscript.includes('лимит токенов') ||
    cleanTranscript.includes('превышена квота') ||
    cleanTranscript.includes('resource_exhausted') ||
    cleanTranscript.includes('rate-limits') ||
    cleanTranscript.includes('Gemini') ||
    cleanTranscript.includes('Ошибка:') ||
    cleanTranscript.includes('отсутствует диалог') ||
    cleanTranscript.includes('Запись разговора и стенограмма отсутствуют') ||
    cleanTranscript.includes('Разговор не состоялся');

  if (isInvalidOrErrorTranscript) {
    cleanTranscript = '';
  }

  if (audioDownloadFailed && !cleanTranscript) {
    appendLog('error', 'megafon', `Анализ звонка прерван: не удалось скачать аудиозапись с сервера Мегафон.`);
    return getFallbackAnalysis('', 'не удавалось скачать', callDurationSeconds);
  }

  let sttErrorReason = '';
  const hasAudio = !!(audioBase64 && audioBase64.data);

  // 1. If audio is available and transcript is missing, transcribe via Russian model Yandex SpeechKit
  if (!cleanTranscript && hasAudio) {
    try {
      const audioBuffer = Buffer.from(audioBase64!.data, 'base64');
      const mime = audioBase64!.mimeType || 'audio/mp3';
      const sttResult = await transcribeAudio(audioBuffer, mime, (type, msg) => appendLog(type, 'speechkit', msg));
      if (sttResult.text && sttResult.text.trim()) {
        cleanTranscript = fixDuplicatedTranscript(sttResult.text.trim());
        appendLog('success', 'speechkit', `Аудиозапись успешно расшифрована Yandex SpeechKit (${cleanTranscript.length} симв.)`);
      } else {
        sttErrorReason = sttResult.error || 'Распознавание речи вернуло пустой текст (в записи отсутствует разборчивая речь или тишина)';
        appendLog('warning', 'speechkit', sttErrorReason);
      }
    } catch (sttErr: any) {
      sttErrorReason = sttErr.message || String(sttErr);
      appendLog('error', 'speechkit', `Ошибка распознавания речи: ${sttErrorReason}`);
    }
  }

  if (cleanTranscript) {
    cleanTranscript = fixDuplicatedTranscript(cleanTranscript);
  }

  // Strict check for calls WITHOUT speech:
  // If duration is unknown and text is ultra-short (<15 chars) without dialogue markers
  if (!cleanTranscript) {
    if (hasAudio) {
      const audioKbytes = Math.round((Buffer.from(audioBase64!.data, 'base64').length) / 1024);
      const durStr = callDurationSeconds !== undefined ? `, ${callDurationSeconds} сек.` : '';
      appendLog('info', 'megafon', `Аудиозапись получена (${audioKbytes} КБ${durStr}). Ожидание расшифровки речи...`);
      
      return {
        transcript: `Стенограмма ожидает расшифровки. Аудиозапись доступна в плеере (${audioKbytes} КБ${durStr}).`,
        summary: `Аудиозапись звонка доступна для прослушивания в плеере (${audioKbytes} КБ${durStr}), автоматическая расшифровка ожидает обработки. Вы можете прослушать запись в плеере.`,
        key_facts: {
          is_dispute: false,
          dispute_reason: null,
          promises: [],
          tone_client: 'нейтральный',
          tone_manager: 'нейтральный',
          call_outcome: 'ожидает расшифровки',
          booking_status: 'не применимо',
          client_issue: 'Аудиозапись загружена и воспроизводится в плеере, расшифровка речи ожидает обработки'
        },
        trigger_phrases: [],
        recommendations: [
          'Прослушайте аудиозапись разговора в плеере ниже.',
          'Для расшифровки нажмите кнопку «Пересчитать» или проверьте настройки распознавания речи.'
        ],
        operator_score: null,
        operator_comment: `Запись разговора доступна для прослушивания в плеере (${audioKbytes} КБ${durStr}). Оценка работы оператора ожидает распознавания речи.`
      };
    }

    appendLog('warning', 'gigachat', 'Отсутствует аудиозапись или текст диалога для анализа. Вызов ИИ пропущен.');
    return {
      transcript: 'Запись разговора и стенограмма отсутствуют',
      summary: 'Звонок не состоялся или аудиозапись не была сохранена на сервере АТС.',
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        promises: [],
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'не состоялся',
        booking_status: 'не применимо',
        client_issue: 'Отсутствует аудиозапись или текст для анализа'
      },
      trigger_phrases: [],
      recommendations: ['Обеспечить наличие аудиозаписи или текста диалога для проведения анализа.'],
      operator_score: null,
      operator_comment: 'Оценка не выставлена: аудиозапись отсутствует.'
    };
  }

  // 2. Anonymize transcript per 152-ФЗ before sending to LLM
  const anonymizedText = anonymizeTranscript(cleanTranscript);

  // 3. Select GigaChat model
  const db = readDb();
  let modelToUse: GigaChatModel = (requestedModel as GigaChatModel) || db.config.default_gigachat_model || 'GigaChat:Lite';
  if (!modelToUse.startsWith('GigaChat')) {
    modelToUse = 'GigaChat:Lite';
  }

  appendLog('info', 'gigachat', `Отправка обезличенной стенограммы на анализ в ${modelToUse} (длительность: ${callDurationSeconds ?? 'н/д'} сек)...`);
  try {
    const analysis = await analyzeWithRetry(
      anonymizedText,
      modelToUse,
      (type, msg) => appendLog(type, 'gigachat', msg),
      callDurationSeconds
    );
    appendLog('success', 'gigachat', `Анализ звонка успешно выполнен моделью ${modelToUse}.`);
    return {
      transcript: analysis.formatted_transcript || cleanTranscript,
      summary: analysis.transcript_summary,
      booking_status: analysis.booking_status || analysis.key_facts?.booking_status,
      key_facts: {
        ...analysis.key_facts,
        booking_status: analysis.booking_status || analysis.key_facts?.booking_status,
        promises: []
      },
      trigger_phrases: [],
      recommendations: Array.isArray(analysis.recommendations) ? analysis.recommendations : [analysis.recommendations],
      operator_score: analysis.operator_score,
      operator_comment: analysis.operator_comment,
      model_used: modelToUse
    };
  } catch (llmErr: any) {
    appendLog('error', 'gigachat', `Ошибка анализа через GigaChat: ${llmErr.message || llmErr}`);
    return getFallbackAnalysis(cleanTranscript, llmErr.message || String(llmErr), callDurationSeconds);
  }
}

// Local simulation analysis with error-reporting support or premium dynamic transcript parsing
function getFallbackAnalysis(transcript: string, errorReason?: string, callDurationSeconds?: number): Partial<CallRecord> {
  if (errorReason) {
    let readableError = 'Технический сбой аналитики.';
    if (errorReason === 'не удавалось скачать') {
      readableError = 'Ошибка: не удавалось скачать аудиофайл записи разговора с сервера АТС.';
    } else if (errorReason === 'отсутствует ключ GigaChat') {
      readableError = 'Ошибка: отсутствуют данные авторизации Сбер GigaChat (GIGACHAT_AUTH_KEY) в настройках системы.';
    } else if (errorReason === 'исчерпан лимит токенов') {
      readableError = 'Ошибка: превышена квота или лимит запросов к API GigaChat.';
    } else {
      readableError = errorReason;
    }

    return {
      transcript: readableError,
      summary: `Анализ звонка заблокирован из-за ошибки: ${readableError}`,
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        promises: [],
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'не успешно',
        client_issue: errorReason
      },
      trigger_phrases: [],
      recommendations: [
        'Для устранения неполадки проверьте правильность API-ключей в разделе "Интеграции & Модели".',
        'В случае проблем со скачиванием убедитесь, что медиасервер АТС Мегафон доступен из внешней сети.'
      ],
      operator_score: (errorReason === 'исчерпан лимит токенов' || errorReason?.includes('quota') || errorReason?.includes('limit')) ? null : 0,
      operator_comment: `Анализ работы оператора не состоялся по технической причине:\n- ${readableError}\nПожалуйста, устраните проблему и повторите попытку запроса звонков.`
    };
  }

  const cleanTranscript = (transcript || '').trim();
  const lowerClean = cleanTranscript.toLowerCase();

  // 1. Strict guard: calls under 10 seconds
  if (callDurationSeconds !== undefined && callDurationSeconds < 10) {
    return {
      transcript: cleanTranscript || 'Разговор не состоялся (длительность менее 10 сек, диалог отсутствует).',
      summary: `Разговор не состоялся: длительность вызова ${callDurationSeconds} сек (менее 10 секунд), диалог между оператором и клиентом отсутствует.`,
      booking_status: 'не применимо',
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        promises: [],
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'не состоялся',
        booking_status: 'не применимо',
        client_issue: 'Звонок менее 10 секунд / диалог отсутствует'
      },
      trigger_phrases: [],
      recommendations: ['При необходимости повторить попытку дозвона клиенту.'],
      operator_score: null,
      operator_comment: `Оценка не выставляется: разговор не состоялся (длительность ${callDurationSeconds} сек менее 10 секунд, диалог отсутствует).`
    };
  }

  // 2. Empty transcript
  if (!cleanTranscript) {
    const durStr = callDurationSeconds !== undefined ? ` (${callDurationSeconds} сек.)` : '';
    return {
      transcript: `Аудиозапись${durStr} не содержит разборчивой речи.`,
      summary: `Разговор не состоялся: в аудиозаписи${durStr} отсутствуют реплики диалога (зафиксированы гудки, тишина или сброс линии).`,
      booking_status: 'не применимо',
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        promises: [],
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'не состоялся',
        booking_status: 'не применимо',
        client_issue: 'Отсутствует разборчивая речь в аудиозаписи'
      },
      trigger_phrases: [],
      recommendations: ['Проверить качество связи и при необходимости перезвонить клиенту.'],
      operator_score: null,
      operator_comment: `Оценка не выставляется: в аудиозаписи${durStr} не обнаружен состоявшийся диалог оператора и клиента.`
    };
  }

  // 3. Strict detection of pure auto-responder ONLY when there is NO dialogue
  const hasDialogue = (lowerClean.includes('клиент:') && (lowerClean.includes('менеджер:') || lowerClean.includes('администратор:'))) ||
    cleanTranscript.split('\n').filter(l => l.trim().length > 0).length >= 2;

  const isPureAuto = !hasDialogue && (
    lowerClean.includes('автоответчик') ||
    lowerClean.includes('автоинформатор') ||
    lowerClean.includes('голосовой помощник') ||
    lowerClean.includes('голосовая почта') ||
    lowerClean.includes('оставьте сообщение после сигнала') ||
    lowerClean.includes('абонент временно недоступен')
  );

  if (isPureAuto) {
    return {
      transcript: cleanTranscript,
      summary: 'Разговор не состоялся: сработал автоответчик или голосовая почта. Запись не оформлена.',
      booking_status: 'не применимо',
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        promises: [],
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'автоответчик',
        booking_status: 'не применимо',
        client_issue: 'Звонок не состоялся / автоответчик'
      },
      trigger_phrases: [],
      recommendations: [
        'Повторить попытку дозвона клиенту в рабочее время салона «Лик 28».'
      ],
      operator_score: null,
      operator_comment: 'Разговор не состоялся: зафиксирован автоответчик (оценка оператора не выставляется).'
    };
  }

  // 4. Genuine conversation analysis (for calls 10s–60s and longer)
  // Dispute check strictly based on transcript text
  const isDispute = cleanTranscript.toLowerCase().includes('отмен') || 
                    cleanTranscript.toLowerCase().includes('криво') || 
                    cleanTranscript.toLowerCase().includes('жалоб') ||
                    cleanTranscript.toLowerCase().includes('претензи') ||
                    cleanTranscript.toLowerCase().includes('недоволен');

  const lines = cleanTranscript.split('\n');
  const triggerPhrases: string[] = [];
  if (isDispute) {
    for (const line of lines) {
      if (line.toLowerCase().startsWith('клиент:') && (
        line.toLowerCase().includes('ужас') || 
        line.toLowerCase().includes('криво') || 
        line.toLowerCase().includes('отмен') || 
        line.toLowerCase().includes('претензия')
      )) {
        triggerPhrases.push(line.replace(/^клиент:\s*/i, '').trim());
      }
    }
  }

  const isDeclined = lowerClean.includes('не будет в городе') || lowerClean.includes('не смогу') || lowerClean.includes('не получается') || lowerClean.includes('неудобно') || lowerClean.includes('отказ');
  const isBooked = !isDeclined && (
    lowerClean.includes('записали') || lowerClean.includes('записала') || lowerClean.includes('записал') ||
    lowerClean.includes('записываю') || lowerClean.includes('записан') || lowerClean.includes('записана') || lowerClean.includes('записаны') ||
    lowerClean.includes('запишите') || lowerClean.includes('запись оформлена') || lowerClean.includes('запись подтверждена') ||
    lowerClean.includes('до встречи') || lowerClean.includes('ждем вас') || lowerClean.includes('ждём вас') ||
    lowerClean.includes('ждем') || lowerClean.includes('ждём') || lowerClean.includes('жду вас') || lowerClean.includes('будем ждать') ||
    lowerClean.includes('договорились') || lowerClean.includes('согласна') || lowerClean.includes('согласен') ||
    lowerClean.includes('буду к') || lowerClean.includes('буду в') || lowerClean.includes('приду в') || lowerClean.includes('приду к') ||
    lowerClean.includes('подходит время') || lowerClean.includes('подходит этот день') || lowerClean.includes('подтверждаю запись')
  );
  const outcome = isBooked ? 'запись' : (isDeclined ? 'отказ' : (isDispute ? 'перезвон' : 'консультация'));
  const outcomeText = isBooked 
    ? 'Запись успешно подтверждена.' 
    : (isDeclined ? 'Клиент отказалась от предложенного слота из-за невозможности быть в городе/неподходящего времени.' : 'Разговор завершился консультацией.');

  const durPrefix = callDurationSeconds !== undefined ? `[${callDurationSeconds} сек.] ` : '';
  const cleanSnippet = cleanTranscript.replace(/^(клиент:|менеджер:|администратор:)\s*/gim, '').trim().slice(0, 160);

  let summary = '';
  if (isBooked) {
    summary = `${durPrefix}Клиент обратился в салон «Лик 28». Достигнута договоренность о записи на процедуры. Итог: ${outcomeText}`;
  } else if (isDeclined) {
    summary = `${durPrefix}Клиент обратился в салон «Лик 28». Итог: ${outcomeText}`;
  } else if (isDispute) {
    summary = `${durPrefix}Обращение клиента с вопросом/претензией по обслуживанию. Требуется перезвон.`;
  } else {
    summary = `${durPrefix}Краткий диалог / консультация: «${cleanSnippet}»`;
  }

  const score = hasDialogue ? (isDispute ? 7 : 9) : null;
  const operatorComment = hasDialogue
    ? `Оценка сформирована по тексту стенограммы (${cleanTranscript.length} символов). Администратор вежливо проконсультировал клиента по регламенту «Лик 28».`
    : `Краткий обмен репликами. Полноценная оценка регламента не выставляется.`;

  const bookingStatus = isBooked ? 'согласие' : (isDeclined ? 'отказ' : (isDispute ? 'консультация' : 'консультация'));

  return {
    transcript: cleanTranscript,
    summary,
    booking_status: bookingStatus,
    key_facts: {
      is_dispute: isDispute,
      dispute_reason: isDispute ? 'Зафиксировано недовольство в тексте разговора' : null,
      promises: [],
      tone_client: isDispute ? 'недовольный' : 'нейтральный',
      tone_manager: 'спокойный',
      call_outcome: outcome,
      booking_status: bookingStatus,
      client_issue: isDispute ? 'Вопрос по обслуживанию' : 'Запись к мастеру / консультация'
    },
    trigger_phrases: triggerPhrases,
    recommendations: [
      'Следовать стандартам общения и вежливости при обслуживании в салоне «Лик 28».'
    ],
    operator_score: score,
    operator_comment: operatorComment
  };
}

// Helper functions to format call timestamp in UTC+4 timezone
function formatUtc4DateTime(dateStr?: string): string {
  if (!dateStr) return '—';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const utc4Date = new Date(date.getTime() + (4 * 3600 * 1000));
    const day = String(utc4Date.getUTCDate()).padStart(2, '0');
    const month = String(utc4Date.getUTCMonth() + 1).padStart(2, '0');
    const year = utc4Date.getUTCFullYear();
    const hours = String(utc4Date.getUTCHours()).padStart(2, '0');
    const minutes = String(utc4Date.getUTCMinutes()).padStart(2, '0');
    return `${day}.${month}.${year} ${hours}:${minutes} (UTC+4)`;
  } catch (e) {
    return dateStr;
  }
}

function formatUtc4Date(dateStr?: string): string {
  if (!dateStr) return '—';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const utc4Date = new Date(date.getTime() + (4 * 3600 * 1000));
    const day = String(utc4Date.getUTCDate()).padStart(2, '0');
    const month = String(utc4Date.getUTCMonth() + 1).padStart(2, '0');
    const year = utc4Date.getUTCFullYear();
    return `${day}.${month}.${year}`;
  } catch (e) {
    return dateStr;
  }
}

function formatUtc4Time(dateStr?: string): string {
  if (!dateStr) return '—';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const utc4Date = new Date(date.getTime() + (4 * 3600 * 1000));
    const hours = String(utc4Date.getUTCHours()).padStart(2, '0');
    const minutes = String(utc4Date.getUTCMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  } catch (e) {
    return dateStr;
  }
}

function formatCallDuration(seconds?: number): string {
  if (seconds === undefined || seconds === null || isNaN(seconds)) return 'н/д';
  if (seconds <= 0) return '00:00 (0 сек.)';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins === 0) {
    return `${secs} сек.`;
  }
  return `${mins} мин. ${secs} сек. (${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')})`;
}

function formatDurationMmSs(seconds?: number): string {
  if (seconds === undefined || seconds === null || isNaN(seconds)) return '00:00';
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Integration Sender - VK Chat Bot (REST API)
async function sendToVk(call: CallRecord, config: VkConfig, force: boolean = false): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
  if (!config.enabled || !config.token) {
    appendLog('warning', 'vk', `Интеграция с VK: Отправка пропущена (интеграция отключена или токен отсутствует).`);
    return { success: false, error: 'Интеграция с VK отключена или отсутствует токен' };
  }

  // Do NOT send to VK if recording was failed or transcript is missing / loading / error placeholder or technical error occurred
  const statusStr = String(call.status);
  const isTechnicalError = isTechnicalErrorResult(call) || isTechnicalFailedCall(call);
  const isFailedOrLoading = statusStr === 'failed' || 
                            statusStr === 'error' || 
                            isTechnicalError ||
                            !call.transcript || 
                            call.transcript === 'Загрузка аудиозаписи...' || 
                            call.transcript.includes('Аудиозапись не была загружена') ||
                            call.transcript.includes('Запись разговора и стенограмма отсутствуют') ||
                            call.transcript.includes('не удавалось скачать') ||
                            call.transcript.includes('не сформирована') ||
                            call.transcript.includes('не состоялся по технической причине');

  if (!force && isFailedOrLoading) {
    appendLog('info', 'vk', `[Интеграция VK] Отправка звонка ${call.call_id} отложена: произошла ошибка или анализ завершился сбоем. Выгрузка в ВК произойдет только после успешного повторного анализа.`);
    return { success: false, error: 'Анализ звонка завершился с технической ошибкой или ещё не готов' };
  }

  // Check if call was already sent to VK
  if (!force && call.sent_to_vk) {
    appendLog('info', 'vk', `Звонок ${call.call_id} уже ранее успешно опубликован в VK. Повторная загрузка пропущена для экономии токенов.`);
    return { success: true, skipped: true };
  }

  // Format message template
  const isDisputeText = call.key_facts.is_dispute ? '⚠️ ДА (Конфликтный звонок)' : '✅ Нет';
  const disputeReason = call.key_facts.dispute_reason || 'нет';
  const promisesText = call.key_facts.promises.length > 0 ? call.key_facts.promises.join(', ') : 'нет обещаний';
  const recommendationsText = call.recommendations.join('\n- ');

  const callDateTimeUtc4 = formatUtc4DateTime(call.timestamp);
  const callDateUtc4 = formatUtc4Date(call.timestamp);
  const callTimeUtc4 = formatUtc4Time(call.timestamp);
  const durationText = formatCallDuration(call.duration_seconds);
  const durationMmSs = formatDurationMmSs(call.duration_seconds);
  const durationSecText = (call.duration_seconds !== undefined && call.duration_seconds !== null) ? `${call.duration_seconds} сек.` : 'н/д';

  let templateToUse = config.template || '';
  if (!templateToUse.includes('{call_date_time}') && !templateToUse.includes('{call_date}') && !templateToUse.includes('{call_time}') && !templateToUse.includes('{date}') && !templateToUse.includes('{time}') && !templateToUse.includes('{timestamp}')) {
    if (templateToUse.includes('\n')) {
      const firstLineEnd = templateToUse.indexOf('\n');
      templateToUse = templateToUse.slice(0, firstLineEnd) + `\n📅 *Дата и время (UTC+4):* {call_date_time}` + templateToUse.slice(firstLineEnd);
    } else {
      templateToUse = `📅 *Дата и время (UTC+4):* {call_date_time}\n` + templateToUse;
    }
  }

  // Inject duration if not already present in the user template
  if (!templateToUse.includes('{duration}') && !templateToUse.includes('{call_duration}') && !templateToUse.includes('{duration_seconds}') && !templateToUse.includes('{duration_formatted}')) {
    if (templateToUse.includes('{call_date_time}')) {
      templateToUse = templateToUse.replace('{call_date_time}', '{call_date_time}\n⏱️ *Длительность:* {duration}');
    } else if (templateToUse.includes('{call_date}')) {
      templateToUse = templateToUse.replace('{call_date}', '{call_date}\n⏱️ *Длительность:* {duration}');
    } else if (templateToUse.includes('\n')) {
      const firstLineEnd = templateToUse.indexOf('\n');
      templateToUse = templateToUse.slice(0, firstLineEnd) + `\n⏱️ *Длительность:* {duration}` + templateToUse.slice(firstLineEnd);
    } else {
      templateToUse = templateToUse + `\n⏱️ *Длительность:* {duration}`;
    }
  }

  const scoreText = (call.operator_score !== null && call.operator_score !== undefined)
    ? `${call.operator_score}/10`
    : 'не оценивалось';

  let message = templateToUse
    .replace(/{call_id}/g, call.call_id)
    .replace(/{call_date_time}/g, callDateTimeUtc4)
    .replace(/{call_date}/g, callDateUtc4)
    .replace(/{call_time}/g, callTimeUtc4)
    .replace(/{date}/g, callDateUtc4)
    .replace(/{time}/g, callTimeUtc4)
    .replace(/{timestamp}/g, callDateTimeUtc4)
    .replace(/{duration}/g, durationText)
    .replace(/{call_duration}/g, durationText)
    .replace(/{duration_formatted}/g, durationText)
    .replace(/{duration_seconds}/g, durationSecText)
    .replace(/{duration_mmss}/g, durationMmSs)
    .replace(/{client_name}/g, call.client_name || 'Неизвестный клиент')
    .replace(/{operator_score}\/10/g, scoreText)
    .replace(/{operator_score}/g, scoreText)
    .replace(/{summary}/g, call.summary)
    .replace(/{is_dispute_text}/g, isDisputeText)
    .replace(/{dispute_reason}/g, disputeReason)
    .replace(/{promises}/g, promisesText)
    .replace(/{recommendations}/g, recommendationsText);

  try {
    appendLog('info', 'vk', `Отправка результатов звонка ${call.call_id} в чат VK ${config.chatId}...`);
    
    // Perform a REAL integration fetch call as requested
    const response = await fetch('https://api.vk.com/method/messages.send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        access_token: config.token,
        peer_id: config.chatId,
        message: message,
        random_id: String(Math.floor(Math.random() * 1000000000)),
        v: '5.131'
      })
    });
    
    const result = await response.json();
    
    if (result.error) {
      let errorMsg = `Ошибка VK API Code ${result.error.error_code}: ${result.error.error_msg}`;
      if (result.error.error_code === 901) {
        errorMsg += `\n\n💡 РЕШЕНИЕ: Этот пользователь (peer_id: ${config.chatId}) должен написать первое сообщение вашей VK-группе (например, "Старт" или любое приветствие) или разрешить получение сообщений в настройках сообщества. Групповые чат-боты не могут отправлять сообщения пользователю первыми из-за ограничений безопасности ВКонтакте. Если вы отправляете в беседу (групповой чат), убедитесь, что бот добавлен в нее и имеет права администратора на отправку сообщений.`;
      }
      throw new Error(errorMsg);
    }

    // Mark as sent to VK in database
    const db = readDb();
    const callIdx = db.calls.findIndex((c: any) => c.call_id === call.call_id);
    if (callIdx !== -1) {
      db.calls[callIdx].sent_to_vk = true;
      db.calls[callIdx].vk_sent_at = new Date().toISOString();
      writeDb(db);
    }

    appendLog('success', 'vk', `Результаты звонка ${call.call_id} успешно отправлены в VK! Message ID: ${result.response || 'Ok'}`);
    return { success: true };
  } catch (error: any) {
    // If it was just using example credential placeholder, simulate beautifully
    if (config.token.includes('example')) {
      const db = readDb();
      const callIdx = db.calls.findIndex((c: any) => c.call_id === call.call_id);
      if (callIdx !== -1) {
        db.calls[callIdx].sent_to_vk = true;
        db.calls[callIdx].vk_sent_at = new Date().toISOString();
        writeDb(db);
      }
      appendLog('success', 'vk', `[Симуляция VK] Данные успешно сформированы и "отправлены" в чат VK.`, `Сообщение отправлено:\n${message}`);
      return { success: true };
    }
    
    appendLog('error', 'vk', `Ошибка отправки в VK: ${error.message || error}`);
    return { success: false, error: error.message || String(error) };
  }
}

// Integration Sender - Yclients (REST API)
async function sendToYclients(call: CallRecord, config: YclientsConfig) {
  if (!config.enabled || !config.userToken) {
    appendLog('warning', 'yclients', `Интеграция с Yclients: Отправка пропущена (интеграция отключена или токен отсутствует).`);
    return false;
  }

  // Do NOT send to Yclients if call failed with a technical error or audio is not ready
  const statusStr = String(call.status);
  const isTechnicalError = isTechnicalErrorResult(call) || isTechnicalFailedCall(call);
  const isFailedOrLoading = statusStr === 'failed' || 
                            statusStr === 'error' || 
                            isTechnicalError ||
                            !call.transcript || 
                            call.transcript === 'Загрузка аудиозаписи...' || 
                            call.transcript.includes('Аудиозапись не была загружена') ||
                            call.transcript.includes('Запись разговора и стенограмма отсутствуют') ||
                            call.transcript.includes('не удавалось скачать') ||
                            call.transcript.includes('не сформирована') ||
                            call.transcript.includes('не состоялся по технической причине');

  if (isFailedOrLoading) {
    appendLog('info', 'yclients', `[Интеграция Yclients] Отправка звонка ${call.call_id} отложена: произошла ошибка или анализ завершился сбоем. Выгрузка в Yclients произойдет только после успешного повторного анализа.`);
    return false;
  }

  const payload = {
    call_id: call.call_id,
    timestamp: call.timestamp,
    client_name: call.client_name,
    operator_score: call.operator_score,
    is_dispute: call.key_facts.is_dispute,
    summary: call.summary,
    comment: `[ИИ-Анализ CallQA] Оценка: ${call.operator_score}/10. Резюме: ${call.summary}. Конфликт: ${call.key_facts.is_dispute ? 'Да' : 'Нет'}. Обещания: ${call.key_facts.promises.join(', ')}`
  };

  try {
    appendLog('info', 'yclients', `Создание сервисной заметки/задачи для салона ${config.salonId} в Yclients по звонку ${call.call_id}...`);
    
    // Real REST API integration fetch call
    const response = await fetch(`https://api.yclients.com/api/v1/comments/${config.salonId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.userToken}, Partner ${config.partnerToken}`
      },
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    appendLog('success', 'yclients', `Данные анализа успешно засинхронизированы с CRM Yclients!`);
    return true;
  } catch (error: any) {
    if (config.userToken.includes('example')) {
      appendLog('success', 'yclients', `[Симуляция Yclients] Запись привязана к карточке клиента в Yclients. Создана задача по обещаниям менеджера.`, `Payload:\n${JSON.stringify(payload, null, 2)}`);
      return true;
    }
    appendLog('error', 'yclients', `Ошибка отправки в Yclients: ${error.message || error}`);
    return false;
  }
}

// SIMULATED EXTERNAL MEGAFON ATS SERVER
const getMockMegafonServerCalls = () => [
  {
    call_id: 'megafon-ext-101',
    timestamp: new Date(Date.now() - 3600000 * 0.2).toISOString(), // 12 mins ago
    duration_seconds: 135,
    type: 'incoming' as const,
    is_answered: true,
    client_phone: '+7 (911) 222-33-44',
    client_name: 'Виктория Козлова',
    operator_name: 'Анна (администратор)',
    transcript: 'Менеджер: Салон красоты Лик 28, здравствуйте! Меня зовут Анна.\nКлиент: Здравствуйте. Скажите, пожалуйста, у вас есть сегодня окошко на окрашивание в один тон у стилиста?\nМенеджер: Да, сегодня есть свободное время у мастера Натальи на 15:00 и на 18:00.\nКлиент: Давайте на 18:00, пожалуйста.\nМенеджер: Записала вас на 18:00. Как вас зовут?\nКлиент: Виктория.\nМенеджер: Очень приятно, Виктория. До встречи в 18:00!',
    status: 'запись готова'
  },
  {
    call_id: 'megafon-ext-102',
    timestamp: new Date(Date.now() - 3600000 * 0.5).toISOString(), // 30 mins ago
    duration_seconds: 0,
    type: 'incoming' as const,
    is_answered: false,
    client_phone: '+7 (905) 555-66-77',
    client_name: 'Дмитрий Иванов',
    operator_name: 'Мария (администратор)',
    transcript: '',
    status: 'пропущен'
  },
  {
    call_id: 'megafon-ext-103',
    timestamp: new Date(Date.now() - 3600000 * 1.5).toISOString(), // 1.5 hours ago
    duration_seconds: 110,
    type: 'outgoing' as const,
    is_answered: true,
    client_phone: '+7 (926) 333-55-11',
    client_name: 'Светлана Новикова',
    operator_name: 'Дмитрий (менеджер)',
    transcript: 'Менеджер: Алло, Светлана? Здравствуйте, это Дмитрий из салона Лик 28. Вы оставляли заявку на нашем сайте на чистку лица.\nКлиент: Да, здравствуйте, всё верно.\nМенеджер: Хотел предложить вам время завтра на 10:00 или послезавтра в 14:00. Что вам удобнее?\nКлиент: Завтра в 10:00 отлично подойдет.\nМенеджер: Прекрасно, записал вас на завтра в 10:00 к косметологу Ирине. Будем вас ждать!\nКлиент: Спасибо!',
    status: 'запись готова'
  },
  {
    call_id: 'megafon-ext-104',
    timestamp: new Date(Date.now() - 3600000 * 3).toISOString(), // 3 hours ago
    duration_seconds: 0,
    type: 'outgoing' as const,
    is_answered: false,
    client_phone: '+7 (912) 444-88-99',
    client_name: 'Игорь Петров',
    operator_name: 'Мария (администратор)',
    transcript: '',
    status: 'не отвечен'
  },
  {
    call_id: 'megafon-ext-105',
    timestamp: new Date(Date.now() - 3600000 * 6).toISOString(), // 6 hours ago
    duration_seconds: 155,
    type: 'incoming' as const,
    is_answered: true,
    client_phone: '+7 (915) 777-88-22',
    client_name: 'Марина Соколова',
    operator_name: 'Мария (администратор)',
    transcript: 'Менеджер: Алло, здравствуйте! Салон Лик 28, Мария.\nКлиент: Здравствуйте! Я бы хотела уточнить цену на лазерную эпиляцию голеней.\nМенеджер: Да, конечно. Лазерная эпиляция голеней у нас стоит 2500 рублей. Сейчас проходит акция: при первой процедуре мы делаем скидку 20%.\nКлиент: О, это супер! А на субботу есть время?\nМенеджер: Да, в субботу свободно 12:00, 14:30 и 17:00. К какому мастеру вас записать?\nКлиент: Давайте на 12:00, к любому свободному мастеру.\nМенеджер: Записала вас на субботу на 12:00. Будем ждать вас!',
    status: 'запись готова'
  },
  {
    call_id: 'megafon-ext-106',
    timestamp: new Date(Date.now() - 3600000 * 12).toISOString(), // 12 hours ago
    duration_seconds: 0,
    type: 'incoming' as const,
    is_answered: false,
    client_phone: '+7 (963) 123-45-67',
    client_name: 'Екатерина Кравченко',
    operator_name: 'Екатерина (администратор)',
    transcript: '',
    status: 'пропущен'
  },
  {
    call_id: 'megafon-ext-107',
    timestamp: new Date(Date.now() - 3600000 * 24).toISOString(), // 24 hours ago
    duration_seconds: 0,
    type: 'outgoing' as const,
    is_answered: false,
    client_phone: '+7 (999) 888-77-66',
    client_name: 'Михаил Юрьев',
    operator_name: 'Дмитрий (менеджер)',
    transcript: '',
    status: 'не отвечен'
  }
];

// Helper to format date into Megafon VATS YYYY-MM-DD HH:mm:ss format (Samara time UTC+4)
function formatDateForMegafon(date: Date): string {
  // Convert standard date to Samara time (UTC+4)
  const samaraTime = new Date(date.getTime() + 4 * 3600000);
  const pad = (num: number) => String(num).padStart(2, '0');
  const yyyy = samaraTime.getUTCFullYear();
  const MM = pad(samaraTime.getUTCMonth() + 1);
  const dd = pad(samaraTime.getUTCDate());
  const hh = pad(samaraTime.getUTCHours());
  const mm = pad(samaraTime.getUTCMinutes());
  const ss = pad(samaraTime.getUTCSeconds());
  return `${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}`;
}

// Helper to parse Megafon VATS date string into a timezone-aware ISO string (defaulting to Samara UTC+4)
function parseAtsDateToIso(dateStr: string): string {
  if (!dateStr) return new Date().toISOString();
  
  let s = dateStr.trim();
  
  // Separate date and time parts
  const parts = s.split(/\s+/);
  if (parts.length < 2) {
    const fallbackParsed = new Date(s);
    return !isNaN(fallbackParsed.getTime()) ? fallbackParsed.toISOString() : new Date().toISOString();
  }
  
  const datePart = parts[0]; // e.g. "19.07.2026" or "2026-07-19"
  const timePart = parts[1]; // e.g. "18:04:28"
  
  let year = '';
  let month = '';
  let day = '';
  
  if (datePart.includes('.')) {
    // DD.MM.YYYY
    const dParts = datePart.split('.');
    if (dParts.length === 3) {
      day = dParts[0].padStart(2, '0');
      month = dParts[1].padStart(2, '0');
      year = dParts[2];
    }
  } else if (datePart.includes('-')) {
    // YYYY-MM-DD
    const dParts = datePart.split('-');
    if (dParts.length === 3) {
      year = dParts[0];
      month = dParts[1].padStart(2, '0');
      day = dParts[2].padStart(2, '0');
    }
  }
  
  if (year && month && day) {
    const isoWithOffset = `${year}-${month}-${day}T${timePart}+04:00`;
    const testDate = new Date(isoWithOffset);
    if (!isNaN(testDate.getTime())) {
      return testDate.toISOString();
    }
  }

  // Fallback
  let formattedStr = s.replace(' ', 'T');
  if (!formattedStr.includes('+') && !formattedStr.includes('Z') && !/[-+]\d{2}:\d{2}$/.test(formattedStr)) {
    formattedStr += '+04:00';
  }
  const parsedDate = new Date(formattedStr);
  if (!isNaN(parsedDate.getTime())) {
    return parsedDate.toISOString();
  }
  
  const finalFallback = new Date(s);
  return !isNaN(finalFallback.getTime()) ? finalFallback.toISOString() : new Date().toISOString();
}

// Helper to extract the last 4 digits of a phone number
function getPhoneLastFour(phone: string): string {
  if (!phone || phone === 'Не определен') return '';
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : digits;
}

// Search the Megafon VATS API for the actual direct recording link corresponding to a communication ID
async function findRealRecordingLinkFromApi(communicationId: string, token: string): Promise<string | null> {
  try {
    const cleanToken = token.trim().replace(/^['"]|['"]$/g, '');
    const reportId = await getMegafonReportId(cleanToken);
    
    let dateTill = new Date();
    let dateFrom = new Date(Date.now() - 14 * 24 * 3600 * 1000); // Standard 14 days search window
    let useNarrowWindow = false;

    try {
      const db = readDb();
      const existingCall = db.calls.find((c: any) => 
        c.call_id === `megafon-real-${communicationId}` || 
        c.call_id === communicationId ||
        (c.call_id && c.call_id.includes(String(communicationId)))
      );
      if (existingCall && existingCall.timestamp) {
        const callDate = new Date(existingCall.timestamp);
        if (!isNaN(callDate.getTime())) {
          // Set narrow window to 12 hours before and after the call
          dateFrom = new Date(callDate.getTime() - 12 * 3600 * 1000);
          dateTill = new Date(callDate.getTime() + 12 * 3600 * 1000);
          useNarrowWindow = true;
        }
      }
    } catch (dbErr) {
      console.error('Error reading DB in findRealRecordingLinkFromApi:', dbErr);
    }

    const dateFromStr = formatDateForMegafon(dateFrom);
    const dateToStr = formatDateForMegafon(dateTill);
    
    appendLog('info', 'megafon', `[Авто-Поиск] Поиск реальной ссылки записи для ID ${communicationId} (интервал: ${dateFromStr} - ${dateToStr})...`);
    const json = await fetchMegafon('get.mgf_calls', {
      report_id: reportId,
      date_from: dateFromStr,
      date_till: dateToStr,
      limit: useNarrowWindow ? 200 : 1000,
      fields: ["communication_id", "call_records"]
    }, cleanToken);
    
    const data = json.result?.data || [];
    const matchedCall = data.find((item: any) => String(item.communication_id) === String(communicationId));
    if (matchedCall && matchedCall.call_records) {
      let directLink: string | null = null;
      if (typeof matchedCall.call_records === 'object' && matchedCall.call_records !== null) {
        if (Array.isArray(matchedCall.call_records.links) && matchedCall.call_records.links.length > 0) {
          directLink = matchedCall.call_records.links[0];
        } else if (matchedCall.call_records.url || matchedCall.call_records.record_url || matchedCall.call_records.link || matchedCall.call_records.value) {
          directLink = matchedCall.call_records.url || matchedCall.call_records.record_url || matchedCall.call_records.link || matchedCall.call_records.value;
        }
      } else if (Array.isArray(matchedCall.call_records) && matchedCall.call_records.length > 0) {
        const rec = matchedCall.call_records[0];
        if (rec) {
          directLink = typeof rec === 'string' ? rec : (rec.url || rec.record_url || rec.link || rec.value);
        }
      } else if (typeof matchedCall.call_records === 'string') {
        directLink = matchedCall.call_records;
      }

      if (directLink) {
        appendLog('success', 'megafon', `[Авто-Поиск] Найдена прямая ссылка на аудиозапись: ${directLink}`);
        
        // Cache retrieved direct link in database for future requests
        try {
          const db = readDb();
          const callIdx = db.calls.findIndex((c: any) => 
            c.call_id === `megafon-real-${communicationId}` || 
            c.call_id === communicationId ||
            (c.call_id && c.call_id.includes(String(communicationId)))
          );
          if (callIdx !== -1 && db.calls[callIdx].audio_url !== directLink) {
            db.calls[callIdx].audio_url = directLink;
            writeDb(db);
            appendLog('info', 'megafon', `[Авто-Поиск] Кеширована прямая ссылка в БД для звонка ${communicationId}`);
          }
        } catch (dbErr) {
          console.error('Error caching link in DB:', dbErr);
        }

        return directLink;
      }
    }
  } catch (err: any) {
    console.error(`Error in findRealRecordingLinkFromApi for ID ${communicationId}:`, err);
  }
  return null;
}

// Download remote audio recording from Megafon VATS and encode as base64
async function downloadAudioAsBase64(url: string, token?: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const cleanToken = token ? token.trim().replace(/^['"]|['"]$/g, '') : '';
    
    // Extract call UUID/communication_id if present
    const reportMatch = url.match(/vats\.cp\.megafon\.ru\/reports\/mgf_calls\/([^?#/]+)/i) || 
                        url.match(/cp\.megafon\.ru\/reports\/mgf_calls\/([^?#/]+)/i) ||
                        url.match(/\/reports\/mgf_calls\/([^?#/]+)/i) ||
                        url.match(/uuid=([^?#/&]+)/i);

    const callUuid = reportMatch ? reportMatch[1] : null;

    // List of candidate URLs to try in order
    const urlsToTry: string[] = [];

    // 1. If we can resolve direct link via Megafon API, put it first
    if (callUuid && cleanToken) {
      const directLink = await findRealRecordingLinkFromApi(callUuid, cleanToken);
      if (directLink) {
        urlsToTry.push(directLink);
      }
    }

    // 2. Add original URL
    if (url) {
      urlsToTry.push(url);
    }

    // 3. Add API endpoints for callUuid if available
    if (callUuid) {
      urlsToTry.push(`https://vats.cp.megafon.ru/api/v1.0/records?uuid=${callUuid}`);
      urlsToTry.push(`https://data-api.cp.megafon.ru/v2.0/records/${callUuid}`);
      urlsToTry.push(`https://simple-api.cp.megafon.ru/records/${callUuid}`);
    }

    // De-duplicate candidate URLs
    const uniqueUrls = Array.from(new Set(urlsToTry));

    for (let candidateUrl of uniqueUrls) {
      if (!candidateUrl.startsWith('http')) {
        const cleanPath = candidateUrl.startsWith('/') ? candidateUrl : `/${candidateUrl}`;
        candidateUrl = `https://data-api.cp.megafon.ru${cleanPath}`;
      }

      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      };

      let requestUrl = candidateUrl;
      if (cleanToken) {
        headers['Authorization'] = cleanToken;
        headers['X-Authorization'] = cleanToken;
        headers['X-Auth-Token'] = cleanToken;
        headers['X-Token'] = cleanToken;
        
        const separator = requestUrl.includes('?') ? '&' : '?';
        requestUrl = `${requestUrl}${separator}token=${encodeURIComponent(cleanToken)}`;
      }

      try {
        appendLog('info', 'megafon', `Запуск fetch для скачивания аудиозаписи с ${requestUrl}...`);
        const response = await fetch(requestUrl, { headers });
        if (!response.ok) {
          appendLog('warning', 'megafon', `Не удалось скачать аудиозапись с ${requestUrl}: HTTP ${response.status} ${response.statusText}`);
          continue;
        }

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Check if returned payload is HTML instead of actual audio media
        if (contentType.includes('text/html') || buffer.length < 300) {
          const sample = buffer.toString('utf-8', 0, 150).toLowerCase();
          if (sample.includes('<html') || sample.includes('<!doctype') || sample.includes('<body')) {
            appendLog('warning', 'megafon', `Ответ от ${requestUrl} является HTML-страницей, а не аудиофайлом. Пробуем следующий адрес...`);
            continue;
          }
        }

        const mimeType = contentType.includes('audio') ? contentType : 'audio/mp3';
        appendLog('success', 'megafon', `Аудиозапись успешно загружена (${buffer.length} байт).`);
        return {
          data: buffer.toString('base64'),
          mimeType
        };
      } catch (fetchErr: any) {
        appendLog('warning', 'megafon', `Ошибка сетевого запроса к ${requestUrl}: ${fetchErr.message || fetchErr}`);
      }
    }
  } catch (err: any) {
    console.error(`Error in downloadAudioAsBase64 for ${url}:`, err);
  }
  return null;
}

// Helper to accurately determine call direction (incoming / outgoing)
export function determineCallDirection(item: any, transcript = '', summary = ''): 'incoming' | 'outgoing' {
  if (!item && !transcript && !summary) return 'incoming';

  // 1. Direct explicit string/object properties from Megafon VATS or webhook payload
  const candidates = [
    item?.call_direction?.value_id,
    item?.call_direction?.value,
    item?.call_direction,
    item?.direction?.value_id,
    item?.direction?.value,
    item?.direction,
    item?.call_type?.value_id,
    item?.call_type?.value,
    item?.call_type,
    item?.type?.value_id,
    item?.type?.value,
    item?.type,
    item?.kind
  ];

  for (const c of candidates) {
    if (typeof c === 'string') {
      const lower = c.trim().toLowerCase();
      if (lower === 'in' || lower === 'incoming' || lower.includes('вход') || lower === '1') {
        return 'incoming';
      }
      if (lower === 'out' || lower === 'outgoing' || lower.includes('исход') || lower === '2') {
        return 'outgoing';
      }
    } else if (typeof c === 'number') {
      if (c === 1) return 'incoming';
      if (c === 2) return 'outgoing';
    }
  }

  // 2. Megafon VATS boolean or numeric flag: received_call (1 or true => incoming)
  if (item?.received_call === true || item?.received_call === 1 || item?.received_call === '1' || item?.is_incoming === true) {
    return 'incoming';
  }

  // 3. Check summary markers
  const sumLower = (summary || item?.summary || '').toLowerCase();
  if (sumLower.includes('пропущенный входящий') || sumLower.includes('входящий')) {
    return 'incoming';
  }
  if (sumLower.includes('исходящий') || sumLower.includes('непринятый исходящий')) {
    return 'outgoing';
  }

  // 4. Check transcript dialogue initiator
  const trLower = (transcript || item?.transcript || '').toLowerCase();
  if (
    trLower.includes('салон красоты лик 28') ||
    trLower.includes('салон лик 28') ||
    trLower.includes('салон красоты лик, 28') ||
    trLower.includes('чем могу вам помочь') ||
    trLower.includes('чем я могу вам помочь') ||
    trLower.includes('чем могу помочь') ||
    trLower.includes('слушаю вас')
  ) {
    // If the manager answers with the salon greeting asking how to help, the client called in!
    return 'incoming';
  }
  if (
    trLower.includes('вас беспокоит салон') ||
    trLower.includes('беспокоит салон красоты') ||
    trLower.includes('вы у нас были записаны') ||
    trLower.includes('напоминаем о вашей записи') ||
    trLower.includes('прошу прощения, что вам не сразу перезвонила')
  ) {
    // Outbound reach from salon to client
    return 'outgoing';
  }

  // Default for beauty salon calls is incoming inquiry
  return 'incoming';
}

// Helper to parse HH:MM:SS format to seconds
function parseDurationToSeconds(durationStr: string | number): number {
  if (typeof durationStr === 'number') return durationStr;
  if (!durationStr) return 0;
  const parts = durationStr.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  const parsed = Number(durationStr);
  return isNaN(parsed) ? 0 : parsed;
}

// Helper to query Megafon APIs with fallback URLs (data-api / simple-api)
async function fetchMegafon(method: string, params: any, token: string): Promise<any> {
  const mergedParams = {
    access_token: token,
    ...params
  };

  const payload = {
    jsonrpc: '2.0',
    id: String(Date.now()),
    method,
    params: mergedParams
  };

  const urls = [
    'https://data-api.cp.megafon.ru/v2.0',
    'https://simple-api.cp.megafon.ru'
  ];

  let lastError: Error | null = null;

  for (const url of urls) {
    try {
      appendLog('info', 'megafon', `Отправка JSON-RPC запроса ${method} на ${url}...`);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=UTF-8',
          'Authorization': token
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000)
      });

      const text = await response.text();
      let json: any = null;
      try {
        json = text && text.trim() ? JSON.parse(text) : null;
      } catch (parseErr) {
        throw new Error(`Ответ сервера Мегафон (${url}) не является JSON (HTTP ${response.status}): ${text ? text.slice(0, 150) : 'пустое тело'}`);
      }

      if (response.status === 404) {
        throw new Error(`404 Not Found`);
      }

      if (!response.ok) {
        const errMsg = json?.error?.message || json?.message || json?.error || `HTTP status ${response.status} ${response.statusText}`;
        throw new Error(`Ошибка АТС Мегафон: ${errMsg}`);
      }

      if (!json) {
        throw new Error(`Сервер Мегафон вернул пустой ответ (HTTP ${response.status})`);
      }

      if (json.error) {
        throw new Error(`Megafon API error: ${json.error.message || JSON.stringify(json.error)}`);
      }

      return json;
    } catch (err: any) {
      appendLog('warning', 'megafon', `Запрос ${method} на ${url} не удался: ${err.message || err}`);
      lastError = err;
    }
  }

  throw lastError || new Error(`Все эндпоинты Мегафон вернули ошибку`);
}

// Fetch report list dynamically from Megafon to find report ID of type 'mgf_calls'
async function getMegafonReportId(token: string): Promise<number> {
  try {
    const json = await fetchMegafon('get.reports_list', {}, token);
    if (json.result && json.result.data) {
      // Find report with type 'mgf_calls' or name containing 'История'
      const mgfCallsReport = json.result.data.find((r: any) => r.type === 'mgf_calls' || r.name?.includes('История'));
      if (mgfCallsReport) {
        appendLog('info', 'megafon', `Найден динамический ID отчета истории звонков: ${mgfCallsReport.id}`);
        return mgfCallsReport.id;
      }
    }
  } catch (err: any) {
    appendLog('warning', 'megafon', `Не удалось динамически получить ID отчета Мегафон: ${err.message || err}. Будет использован ID по умолчанию (133186).`);
  }
  return 133186;
}

// Query the real Megafon Cloud Platform VATS CRM API (backing JSON-RPC get.mgf_calls)
async function getRealMegafonCalls(fromDate: Date, toDate: Date, token: string): Promise<any[]> {
  const cleanToken = token ? token.trim().replace(/^['"]|['"]$/g, '') : '';
  if (!cleanToken || cleanToken.includes('example') || cleanToken.includes('token') || cleanToken.length < 10) {
    appendLog('warning', 'megafon', 'Загрузка демонстрационных звонков пропущена. Согласно требованиям, автоматический опрос и ручной импорт работают только для реальных звонков с действительным токеном Мегафон АТС.');
    return [];
  }

  const dateFromStr = formatDateForMegafon(fromDate);
  const dateToStr = formatDateForMegafon(toDate);

  appendLog('info', 'megafon', `Запрос реальных звонков из АТС Мегафон за период с ${dateFromStr} по ${dateToStr}...`);

  try {
    const reportId = await getMegafonReportId(cleanToken);

    const json = await fetchMegafon('get.mgf_calls', {
      report_id: reportId,
      date_from: dateFromStr,
      date_till: dateToStr,
      limit: 1000,
      fields: [
        "communication_id",
        "call_start_date",
        "call_start_time",
        "contact_phone_number",
        "call_direction",
        "call_status",
        "call_type",
        "virtual_phone_number",
        "employees",
        "call_total_duration",
        "call_await_talk_duration",
        "call_talk_duration",
        "call_is_internal",
        "call_finish_reason",
        "employee_rating",
        "call_records",
        "communication_comment",
        "communication_comment_author",
        "received_call",
        "first_employee_for_internal_call",
        "second_employee_for_internal_call",
        "call_finish_date_time",
        "coaches",
        "is_coach_handled_call",
        "virtual_number_comment",
        "is_blacklisted_phone",
        "call_start_date_time",
        "tags",
        "call_processed_mark_duration"
      ]
    }, cleanToken);

    const data = json.result?.data || [];
    appendLog('success', 'megafon', `Успешно получено ${data.length} звонков из АТС Мегафон.`);
    if (data.length > 0) {
      appendLog('info', 'megafon', `Пример полей первого полученного звонка: ${JSON.stringify(Object.keys(data[0]))}`);
    }

    const mappedCalls = data.map((item: any) => {
      const direction = determineCallDirection(item);

      const statusId = item.call_status?.value_id || '';
      const talkDurationSec = parseDurationToSeconds(item.call_talk_duration);
      const totalDurationSec = parseDurationToSeconds(item.call_total_duration);
      
      // True conversation status: answered ONLY if talkDurationSec > 0
      const isAnswered = talkDurationSec > 0;
      const isLost = !isAnswered;

      let status: 'запись готова' | 'пропущен' | 'не отвечен' = 'запись готова';
      if (!isAnswered) {
        status = direction === 'incoming' ? 'пропущен' : 'не отвечен';
      }

      let timestamp = new Date().toISOString();
      let startTimeStr = item.call_start_date_time || item.start_time;
      if (!startTimeStr && item.call_start_date && item.call_start_time) {
        startTimeStr = `${item.call_start_date} ${item.call_start_time}`;
      }
      if (startTimeStr) {
        timestamp = parseAtsDateToIso(startTimeStr);
      }

      const clientPhone = item.contact_phone_number?.value || item.contact_phone_number || 'Не определен';
      let rawClientName = item.contact_name || item.client_name || 'Клиент';
      
      if (rawClientName.includes('(')) {
        rawClientName = rawClientName.split('(')[0].trim();
      }
      
      const lastFour = getPhoneLastFour(clientPhone);
      const clientName = lastFour ? `${rawClientName} (${lastFour})` : rawClientName;
      
      let operatorName = 'Менеджер';
      if (item.employees && Array.isArray(item.employees) && item.employees.length > 0) {
        const names = item.employees.map((emp: any) => {
          if (typeof emp === 'string') {
            try {
              if (emp.startsWith('{')) {
                const parsed = JSON.parse(emp);
                return parsed.value || parsed.name || parsed.fullName || 'Менеджер';
              }
            } catch (e) {}
            return emp;
          }
          if (emp && typeof emp === 'object') {
            return emp.value || emp.name || emp.employee_name || emp.fullName || emp.fullNameInDb || emp.login || JSON.stringify(emp);
          }
          return 'Менеджер';
        }).filter(Boolean);
        if (names.length > 0) {
          operatorName = names.join(', ');
        }
      } else if (item.employee_name || item.operator_name) {
        const emp = item.employee_name || item.operator_name;
        if (typeof emp === 'string') {
          operatorName = emp;
        } else if (emp && typeof emp === 'object') {
          operatorName = emp.value || emp.name || emp.fullName || JSON.stringify(emp);
        }
      }

      let recordPlayUri = item.record_url || item.link || item.audio_url || item.record || null;
      if (item.call_records) {
        if (typeof item.call_records === 'object' && item.call_records !== null) {
          if (Array.isArray(item.call_records.links) && item.call_records.links.length > 0) {
            recordPlayUri = item.call_records.links[0];
          } else if (item.call_records.url || item.call_records.record_url || item.call_records.link || item.call_records.value) {
            recordPlayUri = item.call_records.url || item.call_records.record_url || item.call_records.link || item.call_records.value;
          }
        } else if (Array.isArray(item.call_records) && item.call_records.length > 0) {
          const rec = item.call_records[0];
          if (rec) {
            recordPlayUri = typeof rec === 'string' ? rec : (rec.url || rec.record_url || rec.link || rec.value || recordPlayUri);
          }
        } else if (typeof item.call_records === 'string') {
          recordPlayUri = item.call_records;
        }
      }

      // If recordPlayUri is still missing but communication_id is present, fallback to reports link
      if (!recordPlayUri && item.communication_id) {
        recordPlayUri = `https://vats.cp.megafon.ru/reports/mgf_calls/${item.communication_id}`;
      }

      return {
        call_id: `megafon-real-${item.communication_id || item.id || item.session_id || Date.now() + Math.random()}`,
        timestamp,
        duration_seconds: talkDurationSec,
        type: direction,
        is_answered: isAnswered,
        client_phone: clientPhone,
        client_name: clientName,
        operator_name: operatorName,
        transcript: isAnswered ? 'Загрузка аудиозаписи...' : '',
        status,
        record_play_uri: isAnswered ? recordPlayUri : null
      };
    });

    // Сортируем звонки строго в хронологическом порядке (сначала самые старые звонки)
    mappedCalls.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return mappedCalls;
  } catch (error: any) {
    appendLog('error', 'megafon', `Ошибка при запросе звонков из АТС: ${error.message || error}`);
    throw error;
  }
}

// Helper to import a call record from Megafon ATS
async function importCallRecord(extCall: any): Promise<boolean> {
  const db = readDb();
  
  // Check if already imported
  const existingCallIdx = db.calls.findIndex((c: any) => c.call_id === extCall.call_id);
  if (existingCallIdx !== -1) {
    const existingCall = db.calls[existingCallIdx];
    let needsUpdate = false;
    
    // Fix the incorrect demo flag
    if (extCall.call_id.startsWith('megafon-real-') && existingCall.is_demo !== false) {
      existingCall.is_demo = false;
      needsUpdate = true;
    }
    
    // Fill in missing audio_url
    if (!existingCall.audio_url && extCall.record_play_uri) {
      existingCall.audio_url = extCall.record_play_uri;
      needsUpdate = true;
    }

    // Repair the timestamp timezone if they differ
    if (existingCall.timestamp !== extCall.timestamp) {
      existingCall.timestamp = extCall.timestamp;
      needsUpdate = true;
    }

    // Ensure consent is registered in the 152-ФЗ registry even for calls already in DB
    const csSync = readConsentStoreSync();
    const hasConsentInStore = csSync.consents.some(c => c.call_id_origin === existingCall.call_id || (existingCall.consent_id && c.consent_id === existingCall.consent_id));
    if (!existingCall.consent_id || !hasConsentInStore) {
      try {
        const rawP = existingCall.client_phone || (existingCall as any).full_phone || extCall.client_phone || '';
        const clientPhone = typeof rawP === 'object' ? (rawP.value || rawP.phone || '') : String(rawP || '');
        if (existingCall.is_answered) {
          const c = await ensureAutoConsent(clientPhone, existingCall.call_id, existingCall.type || 'incoming', existingCall.timestamp);
          existingCall.consent_id = c.consent_id;
          existingCall.consent_status = c.status as any;
          needsUpdate = true;
        } else {
          const c = await registerConsent({
            client_phone: clientPhone,
            consent_type: 'not_applicable',
            status: 'not_applicable',
            purposes: [],
            call_id: existingCall.call_id,
            call_date: existingCall.timestamp
          });
          existingCall.consent_id = c.consent_id;
          existingCall.consent_status = c.status as any;
          needsUpdate = true;
        }
      } catch (errC) {
        console.warn('[152-ФЗ] Ошибка регистрации согласия для существующего звонка:', errC);
      }
    }

    if (needsUpdate) {
      db.calls[existingCallIdx] = existingCall;
      writeDb(db);
    }

    // Return false: Call already exists in DB
    return false;
  }

  const isAnswered = extCall.is_answered && (extCall.duration_seconds > 0);
  const direction = determineCallDirection(extCall, extCall.transcript, extCall.summary);
  const isIncoming = direction === 'incoming';
  const rawExtPhone = extCall.client_phone || extCall.full_phone || '';
  const clientPhoneStr = typeof rawExtPhone === 'object' ? (rawExtPhone.value || rawExtPhone.phone || '') : String(rawExtPhone || '');
  const maskedPhone = maskPhone(clientPhoneStr || extCall.client_name || '');

  let newCall: CallRecord;

  if (!isAnswered || extCall.duration_seconds === 0) {
    // Unanswered or missed call (00:00 duration)
    newCall = {
      call_id: extCall.call_id,
      timestamp: extCall.timestamp,
      duration_seconds: 0,
      model_used: db.config.activeModel || 'GigaChat:Lite',
      transcript: 'Звонок не состоялся. Длительность разговора 00:00 (пропущенный вызов или сброс). Запись разговора и стенограмма отсутствуют.',
      summary: isIncoming ? 'Пропущенный входящий звонок (00:00)' : 'Исходящий звонок, абонент не ответил (00:00)',
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        promises: [],
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'не успешно',
        booking_status: 'не применимо',
        client_issue: isIncoming ? 'Пропущенный звонок' : 'Непринятый исходящий'
      },
      booking_status: 'не применимо',
      trigger_phrases: [],
      recommendations: isIncoming 
        ? ['Рекомендуется как можно скорее перезвонить клиенту для уточнения цели обращения.'] 
        : ['Попробовать связаться с клиентом повторно в другое время.'],
      operator_score: null,
      operator_comment: isIncoming 
        ? 'Разговор не состоялся: длительность вызова 00:00. Зафиксирован пропущенный вызов.' 
        : 'Разговор не состоялся: абонент не ответил на исходящий вызов сотрудника (00:00).',
      client_name: extCall.client_name,
      client_phone: clientPhoneStr,
      full_phone: clientPhoneStr,
      client_phone_masked: maskedPhone,
      operator_name: extCall.operator_name,
      status: 'missed',
      type: direction,
      is_answered: false,
      is_demo: false
    };

    try {
      const consent = await registerConsent({
        client_phone: clientPhoneStr,
        consent_type: 'not_applicable',
        status: 'not_applicable',
        purposes: [],
        call_id: extCall.call_id,
        call_date: extCall.timestamp
      });
      newCall.consent_id = consent.consent_id;
      newCall.consent_status = consent.status as any;
    } catch (cErr) {
      console.warn('[152-ФЗ] Ошибка регистрации статуса пропущенного звонка:', cErr);
    }

    db.calls.unshift(newCall);
    writeDb(db);
    appendLog(
      'warning', 
      'megafon', 
      isIncoming 
        ? `Импортирован пропущенный вызов (00:00) от ${extCall.client_name} (${extCall.client_phone})`
        : `Импортирован непринятый исходящий вызов (00:00) клиенту ${extCall.client_name} (${extCall.client_phone})`
    );
    return true;
  } else if (extCall.duration_seconds < 10) {
    // Short call under 10 seconds: no dialogue held, strictly null score, no LLM fantasy
    newCall = {
      call_id: extCall.call_id,
      timestamp: extCall.timestamp,
      duration_seconds: extCall.duration_seconds,
      model_used: db.config.activeModel || 'GigaChat:Lite',
      transcript: 'Разговор не состоялся (длительность менее 10 сек, диалог отсутствует).',
      summary: `Разговор не состоялся: длительность вызова ${extCall.duration_seconds} сек (менее 10 секунд), диалог между оператором и клиентом отсутствует.`,
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        promises: [],
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'не состоялся',
        booking_status: 'не применимо',
        client_issue: 'Звонок менее 10 секунд / диалог отсутствует'
      },
      booking_status: 'не применимо',
      trigger_phrases: [],
      recommendations: isIncoming 
        ? ['Рекомендуется связаться с клиентом повторно, так как разговор оборвался до 10 секунд.'] 
        : ['Попробовать связаться с клиентом повторно в другое время.'],
      operator_score: null,
      operator_comment: `Оценка не выставляется: разговор не состоялся (длительность ${extCall.duration_seconds} сек менее 10 секунд, диалог отсутствует).`,
      client_name: extCall.client_name,
      client_phone: clientPhoneStr,
      full_phone: clientPhoneStr,
      client_phone_masked: maskedPhone,
      operator_name: extCall.operator_name,
      status: 'completed',
      type: direction,
      is_answered: false,
      audio_url: extCall.record_play_uri || undefined,
      is_demo: false
    };

    try {
      const consent = await registerConsent({
        client_phone: clientPhoneStr,
        consent_type: isAnswered ? 'voice' : 'not_applicable',
        status: isAnswered ? 'active' : 'not_applicable',
        purposes: isAnswered ? ['quality_control', 'ai_analysis'] : [],
        call_id: extCall.call_id,
        call_date: extCall.timestamp
      });
      newCall.consent_id = consent.consent_id;
      newCall.consent_status = consent.status as any;
    } catch (cErr) {
      console.warn('[152-ФЗ] Ошибка регистрации согласия короткого звонка:', cErr);
    }

    db.calls.unshift(newCall);
    writeDb(db);
    appendLog('info', 'megafon', `Импортирован короткий звонок ${extCall.call_id} (${extCall.duration_seconds} сек < 10 сек): разговор не состоялся, оценка не выставляется.`);
    return true;
  } else {
    const megafonToken = db.config.megafon?.token;

    // Answered call with recording ready
    newCall = {
      call_id: extCall.call_id,
      timestamp: extCall.timestamp,
      duration_seconds: extCall.duration_seconds,
      model_used: db.config.default_gigachat_model || 'GigaChat:Lite',
      transcript: extCall.transcript || 'Загрузка аудиозаписи...',
      summary: 'Анализ звонка...',
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        promises: [],
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'успешно'
      },
      trigger_phrases: [],
      recommendations: [],
      operator_score: null,
      operator_comment: '',
      client_name: extCall.client_name,
      client_phone: clientPhoneStr,
      full_phone: clientPhoneStr,
      client_phone_masked: maskedPhone,
      operator_name: extCall.operator_name,
      status: 'processing',
      type: direction,
      is_answered: true,
      audio_url: extCall.record_play_uri || undefined,
      is_demo: false
    };

    try {
      const consent = await ensureAutoConsent(clientPhoneStr, extCall.call_id, extCall.type || 'incoming', extCall.timestamp);
      newCall.consent_id = consent.consent_id;
      newCall.consent_status = consent.status as any;
    } catch (cErr) {
      console.warn('[152-ФЗ] Ошибка авто-регистрации согласия:', cErr);
    }

    db.calls.unshift(newCall);
    writeDb(db);
    appendLog('info', 'megafon', `Начат импорт записи звонка ${extCall.call_id} от клиента ${extCall.client_name}. Длительность: ${extCall.duration_seconds} сек.`);

    // Run AI analysis asynchronously
    (async () => {
      try {
        let audioBase64: { data: string; mimeType: string } | undefined = undefined;
        let audioDownloadFailed = false;

        if (extCall.record_play_uri) {
          appendLog('info', 'megafon', `Скачивание аудиозаписи звонка ${extCall.call_id} для ИИ-анализа...`);
          const audioData = await downloadAudioAsBase64(extCall.record_play_uri, megafonToken);
          if (audioData) {
            audioBase64 = audioData;
            appendLog('success', 'megafon', `Аудиозапись звонка ${extCall.call_id} успешно скачана.`);
          } else {
            audioDownloadFailed = true;
            appendLog('warning', 'megafon', `Не удалось скачать аудиозапись звонка ${extCall.call_id}. Запись будет помечена ошибкой скачивания.`);
          }
        }

        const analysisResult = await analyzeCallTextOrAudio(
          db.config.activeModel || 'GigaChat:Lite',
          extCall.transcript,
          audioBase64,
          audioDownloadFailed,
          extCall.duration_seconds
        );

        const updatedDb = readDb();
        const callIdx = updatedDb.calls.findIndex((c: any) => c.call_id === extCall.call_id);
        
        if (callIdx !== -1) {
          const isFailedCall = audioDownloadFailed || isTechnicalErrorResult(analysisResult);
          updatedDb.calls[callIdx] = {
            ...updatedDb.calls[callIdx],
            ...analysisResult,
            status: isFailedCall ? 'failed' : 'completed'
          } as CallRecord;
          
          const savedCall = updatedDb.calls[callIdx];
          writeDb(updatedDb);

          // Trigger real-time toast notification for managers & admins
          notifyCallAnalyzed(savedCall);

          appendLog('success', 'megafon', `Успешно импортирован звонок ${extCall.call_id} от ${extCall.client_name} (статус: ${savedCall.status})`);

          // Trigger integrations only if processing completed cleanly without technical failure
          if (!isFailedCall && savedCall.status === 'completed') {
            if (updatedDb.config.vk.enabled) {
              await sendToVk(savedCall, updatedDb.config.vk);
            }
            if (updatedDb.config.yclients.enabled) {
              await sendToYclients(savedCall, updatedDb.config.yclients);
            }
          } else {
            appendLog('info', 'megafon', `Звонок ${extCall.call_id}: аудиозапись не сформирована или произошла ошибка, отправка в ВК отложена до успешной повторной загрузки.`);
          }
        }
      } catch (err: any) {
        const errorDb = readDb();
        const callIdx = errorDb.calls.findIndex((c: any) => c.call_id === extCall.call_id);
        if (callIdx !== -1) {
          errorDb.calls[callIdx].status = 'failed';
          errorDb.calls[callIdx].error_message = err.message || String(err);
          writeDb(errorDb);
        }
        appendLog('error', 'megafon', `Ошибка при обработке записи звонка ${extCall.call_id}: ${err.message}`);
      }
    })();

    return true;
  }
}

// Helper to check if automatic ATS polling is permitted (allowed only from 06:00 to 22:00 MSK)
function isAtsPollingAllowedTime(): boolean {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Moscow',
      hour: 'numeric',
      hour12: false
    });
    const hour = parseInt(formatter.format(new Date()), 10);
    return hour >= 6 && hour < 22;
  } catch (e) {
    const localHour = new Date().getHours();
    return localHour >= 6 && localHour < 22;
  }
}

// Background polling interval checking
setInterval(async () => {
  try {
    const db = readDb();
    const megafon = db.config?.megafon;
    const token = megafon?.token || (db.config as any)?.credentials?.megafonToken || process.env.MEGAFON_TOKEN || '';
    const isPollingEnabled = megafon ? (megafon.pollingEnabled !== false && megafon.active !== false) : false;

    if (token && isPollingEnabled) {
      const hasCallsInDb = Array.isArray(db.calls) && db.calls.length > 0;
      const defaultPastMs = hasCallsInDb ? 3600000 * 24 : 86400000 * 30;
      const lastPollStr = megafon.lastPollingTime || new Date(Date.now() - defaultPastMs).toISOString();
      const lastPollDate = new Date(lastPollStr);
      
      const intervalMins = Math.max(1, parseInt(String(megafon.pollingIntervalMinutes || 15), 10));
      const intervalMs = intervalMins * 60 * 1000;
      
      if (Date.now() - lastPollDate.getTime() < intervalMs) {
        return; // Not enough time has passed yet
      }

      const now = new Date();

      appendLog('info', 'megafon', `[Авто-Опрос АТС] Выполнение планового фонового опроса АТС Мегафон (интервал: ${intervalMins} мин)...`);

      // 1. Scan for calls in DB that failed due to technical errors and retry at most 1 call per cycle (max 3 auto-retries per call)
      try {
        const failedCalls = db.calls.filter((c: any) => isTechnicalFailedCall(c) && c.call_id && c.call_id.startsWith('megafon-real-') && ((c.auto_retry_count || 0) < 3));
        if (failedCalls.length > 0) {
          const callToRetry = failedCalls[0];
          const callIdx = db.calls.findIndex((c: any) => c.call_id === callToRetry.call_id);
          if (callIdx !== -1) {
            db.calls[callIdx].auto_retry_count = (db.calls[callIdx].auto_retry_count || 0) + 1;
            writeDb(db);
          }
          appendLog('info', 'megafon', `[Авто-Опрос АТС] Обнаружено звонков с неполным анализом: ${failedCalls.length}. Выполняется повторный анализ для ${callToRetry.call_id} (попытка ${((callToRetry.auto_retry_count || 0) + 1)} из 3)...`);
          try {
            await performCallReanalysis(callToRetry.call_id);
          } catch (errRetry: any) {
            console.error(`[Авто-Опрос АТС] Ошибка автоматического повтора для ${callToRetry.call_id}:`, errRetry);
          }
        }
      } catch (errFailedScan) {
        console.error('Error scanning failed calls in polling loop:', errFailedScan);
      }

      // 2. Query Megafon API for calls from lastPollDate (with 1h safety overlap) to now
      const queryFromDate = hasCallsInDb ? new Date(lastPollDate.getTime() - 1 * 3600000) : new Date(Date.now() - 86400000 * 30);
      const newCalls = await getRealMegafonCalls(queryFromDate, now, token);

      let importedCount = 0;
      for (const extCall of newCalls) {
        const imported = await importCallRecord(extCall);
        if (imported) {
          importedCount++;
        }
      }

      // Update lastPollingTime in DB to now and reconcile consents
      const updatedDb = readDb();
      updatedDb.config.megafon.lastPollingTime = now.toISOString();
      await syncConsentsFromCalls(updatedDb.calls);
      writeDb(updatedDb);

      if (importedCount > 0) {
        appendLog('success', 'megafon', `[Авто-Опрос АТС] Найдено и импортировано новых звонков: ${importedCount}. Следующий опрос через ${intervalMins} мин.`);
      } else {
        appendLog('info', 'megafon', `[Авто-Опрос АТС] Проверка завершена. Новых звонков не обнаружено. Следующий фоновый опрос через ${intervalMins} мин.`);
      }
    }
  } catch (err) {
    console.error('Error in background polling:', err);
  }
}, 30000); // Check state every 30 seconds

// REST API ROUTES

// Health check endpoint for Docker / Container orchestrators
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// Helper to execute S3 hydration into local database stores
async function performS3Hydration(): Promise<boolean> {
  try {
    const data = await hydrateFromS3();
    if (data) {
      const db = readStoreSync();
      if (Array.isArray(data.calls)) db.calls = data.calls;
      if (Array.isArray(data.logs)) db.logs = data.logs;
      if (data.config) db.config = { ...db.config, ...data.config };
      if (Array.isArray(data.users) && data.users.length > 0) db.users = data.users;
      if (Array.isArray(data.access_log)) db.access_log = data.access_log;
      await writeStore(db);

      if (Array.isArray(data.consents)) {
        const consentStore = readConsentStoreSync();
        consentStore.consents = data.consents;
        await writeConsentStore(consentStore);
      }
      return true;
    }
    return false;
  } catch (err) {
    console.error('[S3 Hydration Error]', err);
    return false;
  }
}

// S3 Storage Status & Sync endpoints
app.get('/api/s3/status', async (req, res) => {
  const status = await getSyncStatus();
  res.json({
    configured: status.connected,
    bucket: status.bucket,
    endpoint: status.endpoint,
    key: status.key,
    lastSync: status.synced_at,
    lastError: status.error || null,
    ...status
  });
});

app.get('/api/sync/status', async (req, res) => {
  const status = await getSyncStatus();
  res.json(status);
});

app.post('/api/s3/sync', async (req, res) => {
  try {
    const result = await manualSync(getFullDataForSync);
    return res.json({
      success: result.ok,
      message: `База данных успешно сохранена в S3 timeweb.cloud (${result.size_bytes} байт)`,
      lastSync: result.synced_at
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: `Ошибка записи в S3: ${err.message || err}` });
  }
});

app.post('/api/sync', async (req, res) => {
  try {
    const result = await manualSync(getFullDataForSync);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.post('/api/s3/pull', async (req, res) => {
  try {
    const ok = await performS3Hydration();
    if (ok) {
      const db = readStoreSync();
      return res.json({ success: true, message: 'Данные успешно загружены из S3 timeweb.cloud', callsCount: db.calls?.length || 0 });
    } else {
      return res.status(404).json({ success: false, message: 'Данные в S3 не найдены или произошла ошибка' });
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, message: `Ошибка получения данных из S3: ${err.message || err}` });
  }
});

// Proxy endpoint to securely fetch Megafon audio recordings with Authorization headers
app.get('/api/megafon-ats/record-proxy', async (req, res) => {
  const audioUrl = req.query.url as string;
  if (!audioUrl) {
    return res.status(400).send('Missing url parameter');
  }

  try {
    const db = readDb();
    const token = db.config.megafon?.token;
    const cleanToken = token ? token.trim().replace(/^['"]|['"]$/g, '') : '';

    let finalUrl = audioUrl;
    let callId: string | null = null;
    
    // Auto-detect and transform Megafon report web links to API direct download links
    const reportMatch = audioUrl.match(/vats\.cp\.megafon\.ru\/reports\/mgf_calls\/([^?#/]+)/i) || 
                        audioUrl.match(/cp\.megafon\.ru\/reports\/mgf_calls\/([^?#/]+)/i) ||
                        audioUrl.match(/\/reports\/mgf_calls\/([^?#/]+)/i) ||
                        audioUrl.match(/uuid=([^?#/&]+)/i);
                        
    if (reportMatch && reportMatch[1]) {
      callId = reportMatch[1];
      if (cleanToken) {
        const directLink = await findRealRecordingLinkFromApi(callId, cleanToken);
        if (directLink) {
          finalUrl = directLink;
        } else {
          finalUrl = `https://vats.cp.megafon.ru/api/v1.0/records?uuid=${callId}`;
        }
      } else {
        finalUrl = `https://vats.cp.megafon.ru/api/v1.0/records?uuid=${callId}`;
      }
    } else if (!audioUrl.startsWith('http')) {
      const cleanPath = audioUrl.startsWith('/') ? audioUrl : `/${audioUrl}`;
      finalUrl = `https://data-api.cp.megafon.ru${cleanPath}`;
    }

    const headers: Record<string, string> = {};
    if (cleanToken) {
      headers['Authorization'] = cleanToken;
      headers['X-Authorization'] = cleanToken;
      headers['X-Auth-Token'] = cleanToken;
      headers['X-Token'] = cleanToken;

      // Pass token as query parameter as well for cdn compatibility
      const separator = finalUrl.includes('?') ? '&' : '?';
      finalUrl = `${finalUrl}${separator}token=${encodeURIComponent(cleanToken)}`;
    }

    appendLog('info', 'megafon', `Запрос проксирования аудиозаписи: ${finalUrl}`);

    const response = await fetch(finalUrl, { headers });
    if (!response.ok) {
      appendLog('error', 'megafon', `Не удалось проксировать запись: ${response.status} ${response.statusText}`);
      return res.status(response.status).send(`Failed to fetch audio: ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type') || 'audio/mpeg';
    if (contentType.includes('text/html')) {
      appendLog('error', 'megafon', `Ссылка на аудиозапись вернула HTML-страницу личного кабинета Мегафона. Требуется прямая ссылка.`);
      return res.status(400).send('Ошибка: Ссылка ведет на веб-страницу личного кабинета Мегафона, которая требует ввода логина/пароля в браузере. Вы можете прослушать оригинал, перейдя по ссылке "Оригинал АТС" в деталях звонка.');
    }

    res.setHeader('Content-Type', contentType);
    
    const filename = callId ? `megafon-call-${callId}.mp3` : (path.basename(finalUrl.split('?')[0]) || 'recording.mp3');
    const cleanFilename = filename.endsWith('.mp3') ? filename : `${filename}.mp3`;
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(cleanFilename)}"`);

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    res.send(buffer);
  } catch (error: any) {
    console.error('Error proxying audio:', error);
    res.status(500).send(`Internal server error: ${error.message}`);
  }
});

// Simulated/Real external Megafon API call list
app.get('/api/megafon-ats/calls', async (req, res) => {
  const fromDate = req.query.from ? new Date(req.query.from as string) : new Date(Date.now() - 3600000 * 12);
  const toDate = req.query.to ? new Date(req.query.to as string) : new Date();
  
  const db = readDb();
  const token = db.config.megafon.token;

  try {
    const calls = await getRealMegafonCalls(fromDate, toDate, token);
    res.json(calls);
  } catch (err: any) {
    res.status(500).json({ error: 'Ошибка получения списка звонков из АТС', details: err.message });
  }
});

// Helper to get effective Megafon token from db config or env
function getEffectiveMegafonToken(db: any): string {
  const token = db?.config?.megafon?.token || db?.config?.credentials?.megafonToken || process.env.MEGAFON_TOKEN || '';
  return typeof token === 'string' ? token.trim().replace(/^['"]|['"]$/g, '') : '';
}

// Manual period load trigger
app.post('/api/calls/fetch-period', async (req, res) => {
  const from = req.body?.from || req.body?.start;
  const to = req.body?.to || req.body?.end;
  
  if (!from || !to) {
    return res.status(400).json({ success: false, error: 'Параметры периода ("from" / "to") обязательны' });
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);
  
  const db = readDb();
  const token = getEffectiveMegafonToken(db);

  if (!token || token.includes('example') || token.includes('token') || token.length < 10) {
    appendLog('warning', 'megafon', 'Ручной импорт звонков: токен Мегафон не настроен или содержит шаблонное значение.');
    return res.status(400).json({ 
      success: false, 
      error: 'Токен АТС Мегафон не настроен. Пожалуйста, укажите действующий токен в панели администратора (вкладка «Токены и ключи»).',
      imported: 0,
      importedCount: 0
    });
  }

  appendLog('info', 'megafon', `Запущен ручной импорт звонков за период с ${fromDate.toLocaleString()} по ${toDate.toLocaleString()}.`);

  try {
    const periodCalls = await getRealMegafonCalls(fromDate, toDate, token);

    let importedCount = 0;
    for (const extCall of periodCalls) {
      const imported = await importCallRecord(extCall);
      if (imported) {
        importedCount++;
      }
    }

    const updatedDb = readDb();
    await syncConsentsFromCalls(updatedDb.calls);
    writeDb(updatedDb);

    return res.json({
      success: true,
      found: periodCalls.length,
      imported: importedCount,
      importedCount: importedCount,
      message: `Импорт завершен. Добавлено новых звонков: ${importedCount} из ${periodCalls.length} найденных.`
    });
  } catch (err: any) {
    appendLog('error', 'megafon', `Ошибка импорта звонков: ${err.message || err}`);
    return res.status(500).json({ 
      success: false, 
      error: `Ошибка ручного импорта звонков: ${err.message || err}`, 
      details: err.message 
    });
  }
});

// Manual trigger for poll check (supports both /api/calls/fetch-poll and /api/calls/poll-now)
const handleAtsPoll = async (req: express.Request, res: express.Response) => {
  const db = readDb();
  const token = getEffectiveMegafonToken(db);

  if (!token || token.includes('example') || token.includes('token') || token.length < 10) {
    appendLog('warning', 'megafon', 'Попытка опроса АТС: токен Мегафон не настроен или содержит шаблонное значение.');
    return res.status(400).json({
      success: false,
      error: 'Токен АТС Мегафон не настроен. Пожалуйста, укажите действующий токен в панели администратора (вкладка «Токены и ключи»).',
      imported: 0,
      importedCount: 0
    });
  }

  let fromDate: Date;
  let toDate: Date;

  const hasCallsInDb = Array.isArray(db.calls) && db.calls.length > 0;
  const defaultPastMs = hasCallsInDb ? 3600000 * 24 : 86400000 * 30;

  if (req.body?.start || req.body?.from) {
    fromDate = new Date(req.body.start || req.body.from);
    toDate = req.body?.end || req.body?.to ? new Date(req.body.end || req.body.to) : new Date();
  } else {
    const lastPollStr = db.config.megafon.lastPollingTime || new Date(Date.now() - defaultPastMs).toISOString();
    const lastPollDate = new Date(lastPollStr);
    fromDate = hasCallsInDb ? new Date(lastPollDate.getTime() - 1 * 3600000) : new Date(Date.now() - 86400000 * 30);
    toDate = new Date();
  }

  appendLog('info', 'megafon', `Ручной запуск опроса АТС с ${fromDate.toLocaleString()} по ${toDate.toLocaleString()}`);

  try {
    const newCalls = await getRealMegafonCalls(fromDate, toDate, token);

    let importedCount = 0;
    for (const extCall of newCalls) {
      const imported = await importCallRecord(extCall);
      if (imported) {
        importedCount++;
      }
    }

    const updatedDb = readDb();
    updatedDb.config.megafon.lastPollingTime = toDate.toISOString();
    await syncConsentsFromCalls(updatedDb.calls);
    writeDb(updatedDb);

    return res.json({
      success: true,
      imported: importedCount,
      importedCount: importedCount,
      found: newCalls.length,
      lastPollingTime: updatedDb.config.megafon.lastPollingTime,
      message: `Опрос завершен: добавлено новых звонков: ${importedCount} из ${newCalls.length} найденных.`
    });
  } catch (err: any) {
    appendLog('error', 'megafon', `Ошибка опроса АТС: ${err.message || err}`);
    return res.status(500).json({ 
      success: false, 
      error: `Ошибка опроса АТС Мегафон: ${err.message || err}`, 
      details: err.message 
    });
  }
};

app.post('/api/calls/fetch-poll', handleAtsPoll);
app.post('/api/calls/poll-now', handleAtsPoll);

// 1. GET ALL CALLS (with 152-ФЗ Role Masking & Consent mapping)
app.get('/api/calls', (req, res) => {
  const db = readDb();
  const userRole = getCurrentUserRole(req);

  const mappedCalls = (db.calls || []).map((c: any) => {
    const rawPhone = c.client_phone || c.full_phone || '';
    const masked = c.client_phone_masked || maskPhone(rawPhone);
    const consent = getConsentForPhone(rawPhone);

    let bookingStatus = c.booking_status || c.key_facts?.booking_status;
    if (!bookingStatus) {
      const outcome = (c.key_facts?.call_outcome || '').toLowerCase();
      const summary = (c.summary || '').toLowerCase();
      if (outcome === 'запись' || summary.includes('запись подтверждена') || summary.includes('записан')) {
        bookingStatus = 'согласие';
      } else if (outcome === 'отказ' || summary.includes('отказ') || summary.includes('не будет в городе')) {
        bookingStatus = 'отказ';
      } else if (outcome === 'автоответчик') {
        bookingStatus = 'не применимо';
      } else {
        bookingStatus = 'консультация';
      }
    }

    const callCopy: any = {
      ...c,
      booking_status: bookingStatus,
      client_phone_masked: masked,
      consent_status: consent?.status || (c.status === 'missed' ? 'not_applicable' : 'active'),
      consent_purposes: consent?.purposes || ['quality_control', 'training']
    };

    // Role-based data access (RBAC & 152-ФЗ):
    if (userRole === 'viewer') {
      delete callCopy.transcript;
      delete callCopy.client_phone;
      delete callCopy.full_phone;
      delete callCopy.audio_url;
    } else if (userRole === 'manager' || userRole === 'operator') {
      // Mask full phone number for operators and managers per 152-ФЗ
      delete callCopy.full_phone;
      callCopy.client_phone = masked;
    }

    return callCopy;
  });

  res.json(mappedCalls);
});

// 2. GET SINGLE CALL (with 152-ФЗ Role Masking)
app.get('/api/calls/:id', (req, res) => {
  const db = readDb();
  const userRole = getCurrentUserRole(req);
  const call = db.calls.find((c: any) => c.call_id === req.params.id);
  if (!call) {
    return res.status(404).json({ error: 'Звонок не найден' });
  }

  const rawPhone = call.client_phone || call.full_phone || '';
  const masked = call.client_phone_masked || maskPhone(rawPhone);
  const consent = getConsentForPhone(rawPhone);

  let bookingStatus = call.booking_status || call.key_facts?.booking_status;
  if (!bookingStatus) {
    const outcome = (call.key_facts?.call_outcome || '').toLowerCase();
    const summary = (call.summary || '').toLowerCase();
    if (outcome === 'запись' || summary.includes('запись подтверждена') || summary.includes('записан')) {
      bookingStatus = 'согласие';
    } else if (outcome === 'отказ' || summary.includes('отказ') || summary.includes('не будет в городе')) {
      bookingStatus = 'отказ';
    } else if (outcome === 'автоответчик') {
      bookingStatus = 'не применимо';
    } else {
      bookingStatus = 'консультация';
    }
  }

  const callCopy: any = {
    ...call,
    booking_status: bookingStatus,
    client_phone_masked: masked,
    consent_status: consent?.status || (call.status === 'missed' ? 'not_applicable' : 'active'),
    consent_purposes: consent?.purposes || ['quality_control', 'training']
  };

  if (userRole === 'viewer') {
    delete callCopy.transcript;
    delete callCopy.client_phone;
    delete callCopy.full_phone;
    delete callCopy.audio_url;
  } else if (userRole === 'manager' || userRole === 'operator') {
    delete callCopy.full_phone;
    callCopy.client_phone = masked;
  }

  res.json(callCopy);
});

// 2.001. DELETE SINGLE CALL
app.delete('/api/calls/:id', (req, res) => {
  const userRole = getCurrentUserRole(req);
  if (userRole !== 'admin' && userRole !== 'manager') {
    return res.status(403).json({ error: 'Удаление записей звонков разрешено только администраторам и управляющим' });
  }

  const db = readDb();
  const initialLength = db.calls.length;
  db.calls = db.calls.filter((c: any) => c.call_id !== req.params.id);

  if (db.calls.length === initialLength) {
    return res.status(404).json({ error: 'Звонок не найден' });
  }

  if (Array.isArray(db.notifications)) {
    db.notifications = db.notifications.filter((n: any) => n.call_id !== req.params.id);
  }

  writeDb(db);
  appendLog('info', 'system', `Удалена запись звонка ${req.params.id} пользователем с ролью ${userRole}`);
  res.json({ success: true, call_id: req.params.id });
});

// 2.002. CLEAR ALL DEMO CALLS
app.post('/api/calls/clear-demo', (req, res) => {
  const userRole = getCurrentUserRole(req);
  if (userRole !== 'admin' && userRole !== 'manager') {
    return res.status(403).json({ error: 'Очистка демо-звонков разрешена только администраторам и управляющим' });
  }

  const db = readDb();
  const initialLength = db.calls.length;
  db.calls = db.calls.filter((c: any) => !c.is_demo && c.call_id !== 'megafon-call-89101' && c.call_id !== 'megafon-call-89102');
  const removedCount = initialLength - db.calls.length;

  writeDb(db);
  appendLog('info', 'system', `Очищены демонстрационные звонки (${removedCount} шт.)`);
  res.json({ success: true, removedCount });
});

// 2.01. TAG MANAGEMENT: ADD TAG TO CALL
app.post('/api/calls/:id/tags', (req, res) => {
  const db = readDb();
  const call = db.calls.find((c: any) => c.call_id === req.params.id);
  if (!call) {
    return res.status(404).json({ error: 'Звонок не найден' });
  }

  const { tag } = req.body;
  if (!tag || typeof tag !== 'string' || !tag.trim()) {
    return res.status(400).json({ error: 'Необходимо указать наименование тега' });
  }

  const cleanTag = tag.trim().slice(0, 40);
  if (!Array.isArray(call.tags)) {
    call.tags = [];
  }

  if (!call.tags.includes(cleanTag)) {
    call.tags.push(cleanTag);
    writeDb(db);
    appendLog('info', 'system', `Добавлен тег «${cleanTag}» к звонку ${call.call_id}`);
  }

  res.json({ success: true, tags: call.tags, call });
});

// 2.02. TAG MANAGEMENT: REMOVE TAG FROM CALL
app.delete('/api/calls/:id/tags/:tag', (req, res) => {
  const db = readDb();
  const call = db.calls.find((c: any) => c.call_id === req.params.id);
  if (!call) {
    return res.status(404).json({ error: 'Звонок не найден' });
  }

  const rawTag = decodeURIComponent(req.params.tag).trim();
  if (Array.isArray(call.tags)) {
    call.tags = call.tags.filter((t: string) => t !== rawTag);
    writeDb(db);
    appendLog('info', 'system', `Удален тег «${rawTag}» у звонка ${call.call_id}`);
  }

  res.json({ success: true, tags: call.tags || [], call });
});

// 2.03. TAG MANAGEMENT: BULK UPDATE TAGS
app.put('/api/calls/:id/tags', (req, res) => {
  const db = readDb();
  const call = db.calls.find((c: any) => c.call_id === req.params.id);
  if (!call) {
    return res.status(404).json({ error: 'Звонок не найден' });
  }

  const { tags } = req.body;
  if (!Array.isArray(tags)) {
    return res.status(400).json({ error: 'Поле tags должно быть массивом строк' });
  }

  call.tags = Array.from(new Set(tags.map((t: any) => String(t).trim().slice(0, 40)).filter(Boolean)));
  writeDb(db);
  appendLog('info', 'system', `Обновлен список тегов для звонка ${call.call_id}: [${call.tags.join(', ')}]`);

  res.json({ success: true, tags: call.tags, call });
});

// ==============================================================================
// 2.04. REAL-TIME TOAST NOTIFICATIONS & SSE STREAM (ADMIN & MANAGERS)
// ==============================================================================

// 1. SSE Stream for Real-time Notifications
app.get('/api/notifications/stream', (req, res) => {
  const userRole = getCurrentUserRole(req);
  if (userRole !== 'admin' && userRole !== 'manager') {
    return res.status(403).json({ error: 'Уведомления о завершении анализа доступны только администраторам и менеджерам' });
  }

  // Set SSE Headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  const clientId = `client-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  sseNotificationClients.set(clientId, { id: clientId, role: userRole, res });

  // Initial handshake and ping
  res.write(`: connected as ${userRole}\n\n`);

  // Heartbeat ping every 25 seconds to keep connection alive through any reverse proxy
  const pingInterval = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(pingInterval);
      sseNotificationClients.delete(clientId);
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(pingInterval);
    sseNotificationClients.delete(clientId);
  });
});

// 2. Get Notifications List (Admin & Manager)
app.get('/api/notifications', (req, res) => {
  try {
    const userRole = getCurrentUserRole(req);
    if (userRole !== 'admin' && userRole !== 'manager') {
      return res.status(403).json({ error: 'Доступ разрешен только администраторам и менеджерам' });
    }
    const db = readDb();
    res.json(Array.isArray(db?.notifications) ? db.notifications : []);
  } catch (err: any) {
    console.warn('[Notifications] Ошибка получения списка уведомлений:', err?.message || err);
    res.json([]);
  }
});

// 3. Mark Single Notification as Read
app.post('/api/notifications/:id/read', (req, res) => {
  const userRole = getCurrentUserRole(req);
  if (userRole !== 'admin' && userRole !== 'manager') {
    return res.status(403).json({ error: 'Доступ разрешен только администраторам и менеджерам' });
  }
  const db = readDb();
  if (Array.isArray(db.notifications)) {
    const item = db.notifications.find((n: any) => n.id === req.params.id);
    if (item) {
      item.read = true;
      writeDb(db);
    }
  }
  res.json({ success: true });
});

// 4. Mark All Notifications as Read
app.post('/api/notifications/read-all', (req, res) => {
  const userRole = getCurrentUserRole(req);
  if (userRole !== 'admin' && userRole !== 'manager') {
    return res.status(403).json({ error: 'Доступ разрешен только администраторам и менеджерам' });
  }
  const db = readDb();
  if (Array.isArray(db.notifications)) {
    db.notifications.forEach((n: any) => { n.read = true; });
    writeDb(db);
  }
  res.json({ success: true });
});

// 5. Clear All Notifications
app.delete('/api/notifications/clear', (req, res) => {
  const userRole = getCurrentUserRole(req);
  if (userRole !== 'admin' && userRole !== 'manager') {
    return res.status(403).json({ error: 'Доступ разрешен только администраторам и менеджерам' });
  }
  const db = readDb();
  db.notifications = [];
  writeDb(db);
  res.json({ success: true });
});

// 6. Test Notification (for Administrators & Managers to verify sound & toast UI)
app.post('/api/notifications/test', (req, res) => {
  const userRole = getCurrentUserRole(req);
  if (userRole !== 'admin' && userRole !== 'manager') {
    return res.status(403).json({ error: 'Доступ разрешен только администраторам и менеджерам' });
  }
  const db = readDb();
  const sampleCall: CallRecord = db.calls.find((c: any) => c.status === 'completed') || {
    call_id: `test-call-${Date.now()}`,
    timestamp: new Date().toISOString(),
    duration_seconds: 135,
    model_used: 'GigaChat:Lite',
    client_name: 'Елена Васильева (тест)',
    client_phone_masked: '+7 (927) ***-55-44',
    operator_name: 'Мария (администратор)',
    status: 'completed',
    summary: 'Тестовый звонок: клиент подтвердил запись на стрижку и окрашивание на 15:00.',
    booking_status: 'согласие',
    operator_score: 9,
    operator_comment: 'Отличная работа с клиентом, подтверждено время и стоимость услуги.',
    transcript: 'Тестовая стенограмма...',
    trigger_phrases: [],
    key_facts: {
      is_dispute: false,
      dispute_reason: null,
      promises: ['Отправить напоминание в WhatsApp'],
      tone_client: 'дружелюбный',
      tone_manager: 'дружелюбный',
      call_outcome: 'запись',
      booking_status: 'согласие'
    },
    recommendations: ['Поддерживать стандарты вежливого общения']
  };

  const notification = notifyCallAnalyzed(sampleCall);
  res.json({ success: true, notification });
});

// 2.05. INCOMING ATS WEBHOOK (/api/calls/webhook)
app.post('/api/calls/webhook', async (req, res) => {
  try {
    const payload = req.body || {};
    const db = readDb();

    // Verify token if configured
    const expectedToken = (db.config.megafon?.token || '').trim();
    const incomingToken = (req.headers['x-megafon-token'] || req.headers['authorization'] || req.headers['x-api-key'] || req.query.token || payload.token || '').toString().replace(/^Bearer\s+/i, '').trim();
    const userRole = getCurrentUserRole(req);

    // If request comes from authenticated admin/manager or has valid token, allow it
    const isRoleAuthorized = userRole === 'admin' || userRole === 'manager';
    if (!isRoleAuthorized && expectedToken && expectedToken !== 'megafon_ats_auth_token_example_123' && incomingToken !== expectedToken) {
      appendLog('warning', 'megafon', 'Отклонен входящий вебхук: неверный токен авторизации');
      return res.status(401).json({ error: 'Неверный токен авторизации вебхука' });
    }

    const callId = payload.call_id || payload.id || `ats-${Date.now()}`;
    const clientPhone = payload.phone || payload.client_phone || payload.caller || '';
    const maskedPhone = maskPhone(clientPhone);
    const clientName = payload.client_name || `Клиент (${maskedPhone.slice(-4) || 'АТС'})`;
    const operatorName = payload.operator_name || payload.employee || 'Дежурный администратор';
    const duration = Number(payload.duration || payload.duration_seconds || 0);
    const status = payload.status === 'missed' || duration === 0 ? 'missed' : 'completed';
    const direction = determineCallDirection(payload, payload.transcript, payload.summary);

    const newCall: CallRecord = {
      call_id: callId,
      timestamp: payload.timestamp || new Date().toISOString(),
      duration_seconds: duration,
      model_used: db.config.activeModel || 'GigaChat:Lite',
      transcript: payload.transcript || (status === 'missed' ? 'Звонок пропущен или сброшен до ответа' : 'Поступил звонок через АТС. Текст стенограммы...'),
      summary: payload.summary || (status === 'missed' ? (direction === 'incoming' ? 'Пропущенный входящий звонок через АТС' : 'Непринятый исходящий звонок через АТС') : 'Обращение клиента через телефонию АТС'),
      client_name: clientName,
      client_phone_masked: maskedPhone,
      full_phone: clientPhone,
      operator_name: operatorName,
      status: status,
      type: direction,
      is_answered: status !== 'missed',
      booking_status: payload.booking_status || (status === 'missed' ? 'не применимо' : 'консультация'),
      operator_score: (status === 'missed' || duration === 0) ? null : (payload.operator_score !== undefined ? Number(payload.operator_score) : null),
      operator_comment: payload.operator_comment || (status === 'missed' ? 'Разговор не состоялся: зафиксирован пропущенный/неотвеченный вызов.' : 'Обработан оператором'),
      trigger_phrases: [],
      key_facts: {
        is_dispute: Boolean(payload.is_dispute),
        dispute_reason: payload.dispute_reason || null,
        promises: Array.isArray(payload.promises) ? payload.promises : [],
        tone_client: payload.tone_client || 'нейтральный',
        tone_manager: payload.tone_manager || 'спокойный',
        call_outcome: status === 'missed' ? 'перезвон' : (payload.booking_status === 'согласие' ? 'запись' : 'консультация'),
        booking_status: payload.booking_status || (status === 'missed' ? 'не применимо' : 'консультация'),
        client_issue: payload.client_issue || 'Входящий вызов АТС'
      },
      recommendations: status === 'missed' ? ['Перезвонить клиенту'] : ['Продолжить работу по скрипту'],
      tags: status === 'missed' ? ['Перезвонить'] : ['АТС']
    };

    if (payload.transcript && status !== 'missed' && payload.transcript.length > 50) {
      try {
        const gModel = (db.config.default_gigachat_model || 'GigaChat:Lite') as GigaChatModel;
        const analysis = await analyzeWithRetry(payload.transcript, gModel);
        if (analysis) {
          newCall.summary = analysis.transcript_summary || newCall.summary;
          newCall.booking_status = analysis.booking_status || newCall.booking_status;
          newCall.operator_score = analysis.operator_score !== null ? analysis.operator_score : newCall.operator_score;
          newCall.operator_comment = analysis.operator_comment || newCall.operator_comment;
          if (analysis.key_facts) {
            newCall.key_facts = { ...newCall.key_facts, ...analysis.key_facts };
          }
        }
      } catch (analysisErr: any) {
        console.warn('[Webhook AI Analysis Warning]', analysisErr.message);
      }
    }

    db.calls.unshift(newCall);
    writeDb(db);

    appendLog('success', 'megafon', `Принят входящий вебхук по звонку ${callId} (${clientName})`);

    // Trigger Toast Notification for Managers & Admins
    notifyCallAnalyzed(newCall);

    res.json({ success: true, call_id: callId, call: newCall });
  } catch (err: any) {
    appendLog('error', 'megafon', `Ошибка обработки вебхука: ${err.message}`);
    res.status(500).json({ error: 'Ошибка обработки вебхука', details: err.message });
  }
});

// 2.06. EXPORT CALL AUDIT REPORT TO PDF (Для управляющего салоном)
app.get('/api/calls/:id/export-pdf', (req, res) => {
  const db = readDb();
  const userRole = getCurrentUserRole(req);
  const call = db.calls.find((c: any) => c.call_id === req.params.id);
  if (!call) {
    return res.status(404).json({ error: 'Звонок не найден' });
  }

  const rawPhone = call.client_phone || call.full_phone || '';
  const masked = call.client_phone_masked || maskPhone(rawPhone);

  let bookingStatus = call.booking_status || call.key_facts?.booking_status;
  if (!bookingStatus) {
    const outcome = (call.key_facts?.call_outcome || '').toLowerCase();
    const summary = (call.summary || '').toLowerCase();
    if (outcome === 'запись' || summary.includes('запись подтверждена') || summary.includes('записан')) {
      bookingStatus = 'согласие';
    } else if (outcome === 'отказ' || summary.includes('отказ') || summary.includes('не будет в городе')) {
      bookingStatus = 'отказ';
    } else if (outcome === 'автоответчик') {
      bookingStatus = 'не применимо';
    } else {
      bookingStatus = 'консультация';
    }
  }

  const callForReport: any = {
    ...call,
    booking_status: bookingStatus,
    client_phone_masked: masked,
  };

  try {
    const doc = generateCallAuditPdf(callForReport, userRole);
    const filename = `Otchet_Lik28_${call.call_id}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    doc.pipe(res);
    doc.end();
  } catch (error: any) {
    console.error('Ошибка при генерации PDF отчета:', error);
    res.status(500).json({ error: `Ошибка формирования PDF: ${error.message || error}` });
  }
});

// 2.065. EXPORT PERIOD STATS REPORT TO PDF (Сводный отчет за период со сравнительным анализом)
app.post('/api/reports/period-stats-pdf', (req, res) => {
  const userRole = getCurrentUserRole(req);
  try {
    const reportData: PeriodStatsReportData = req.body;
    if (!reportData || !reportData.currentStats) {
      return res.status(400).json({ error: 'Не переданы данные статистики для формирования отчета' });
    }
    reportData.userRole = userRole;

    const doc = generatePeriodStatsPdf(reportData);
    const sanitizedTitle = (reportData.periodTitle || 'period').replace(/[^a-zA-Zа-яА-Я0-9_-]/g, '_');
    const filename = `Otchet_Lik28_${sanitizedTitle}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);

    doc.pipe(res);
    doc.end();
  } catch (error: any) {
    console.error('Ошибка при генерации PDF отчета за период:', error);
    res.status(500).json({ error: `Ошибка формирования PDF: ${error.message || error}` });
  }
});

// 2.06. EXPORT CALL AUDIT REPORT TO CSV (С учетом маскирования 152-ФЗ)
app.get('/api/calls/:id/export-csv', (req, res) => {
  const db = readDb();
  const userRole = getCurrentUserRole(req);
  const call = db.calls.find((c: any) => c.call_id === req.params.id);
  if (!call) {
    return res.status(404).json({ error: 'Звонок не найден' });
  }

  const rawPhone = call.client_phone || call.full_phone || '';
  const masked = call.client_phone_masked || maskPhone(rawPhone);

  let bookingStatus = call.booking_status || call.key_facts?.booking_status;
  if (!bookingStatus) {
    const outcome = (call.key_facts?.call_outcome || '').toLowerCase();
    const summary = (call.summary || '').toLowerCase();
    if (outcome === 'запись' || summary.includes('запись подтверждена') || summary.includes('записан')) {
      bookingStatus = 'согласие';
    } else if (outcome === 'отказ' || summary.includes('отказ') || summary.includes('не будет в городе')) {
      bookingStatus = 'отказ';
    } else if (outcome === 'автоответчик') {
      bookingStatus = 'не применимо';
    } else {
      bookingStatus = 'консультация';
    }
  }

  const callForReport: any = {
    ...call,
    booking_status: bookingStatus,
    client_phone_masked: masked,
  };

  try {
    const csvContent = generateCallCsv(callForReport, userRole);
    const filename = `Otchet_Lik28_${call.call_id}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (error: any) {
    console.error('Ошибка при генерации CSV отчета:', error);
    res.status(500).json({ error: `Ошибка формирования CSV: ${error.message || error}` });
  }
});

// 2.1. REANALYZE CALL WITH SPEECHKIT & GIGACHAT (152-ФЗ Compliant)
app.post('/api/calls/:id/reanalyze', async (req, res) => {
  const { id } = req.params;
  const userRole = getCurrentUserRole(req);
  if (userRole === 'viewer' || userRole === 'operator') {
    return res.status(403).json({ error: 'Недостаточно прав для переанализа (доступно только Администраторам и Управляющим)' });
  }

  const modelOverride = req.body?.model;
  try {
    const updatedCall = await performCallReanalysis(id, modelOverride);
    res.json(updatedCall);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Внутренняя ошибка переанализа звонка' });
  }
});

// 3. ANALYZE NEW CALL (REST API)
app.post('/api/calls/analyze', async (req, res) => {
  const { transcript, client_name, operator_name, duration_seconds, model, audioBase64 } = req.body;
  const db = readDb();
  const selectedModel = model || db.config.activeModel || 'GigaChat:Lite';

  const durationSec = duration_seconds !== undefined ? Number(duration_seconds) : 120;

  // Handle 0 duration and calls under 10 seconds immediately without hallucinating dialogues
  if (durationSec < 10) {
    const newCallId = `call-${Date.now()}`;
    const shortCall: CallRecord = {
      call_id: newCallId,
      timestamp: new Date().toISOString(),
      duration_seconds: durationSec,
      model_used: selectedModel,
      transcript: durationSec === 0
        ? 'Звонок не состоялся. Длительность разговора 00:00 (пропущенный вызов или сброс). Запись разговора и стенограмма отсутствуют.'
        : 'Разговор не состоялся (длительность менее 10 сек, диалог отсутствует).',
      summary: durationSec === 0
        ? 'Пропущенный звонок (00:00)'
        : `Разговор не состоялся: длительность ${durationSec} сек (менее 10 секунд), диалог отсутствует.`,
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        promises: [],
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'не состоялся',
        booking_status: 'не применимо',
        client_issue: durationSec === 0 ? 'Звонок 00:00 / не отвечен' : 'Звонок менее 10 секунд / диалог отсутствует'
      },
      trigger_phrases: [],
      recommendations: ['При необходимости связаться с клиентом повторно.'],
      operator_score: null,
      operator_comment: durationSec === 0
        ? 'Разговор не состоялся: длительность вызова 00:00.'
        : `Оценка не выставляется: разговор не состоялся (длительность ${durationSec} сек менее 10 секунд, диалог отсутствует).`,
      client_name: client_name || 'Новый клиент',
      operator_name: operator_name || 'Менеджер салона',
      status: durationSec === 0 ? 'missed' : 'completed',
      is_answered: false
    };

    db.calls.unshift(shortCall);
    writeDb(db);
    notifyCallAnalyzed(shortCall);
    return res.json(shortCall);
  }

  const newCallId = `call-${Date.now()}`;
  const newCall: CallRecord = {
    call_id: newCallId,
    timestamp: new Date().toISOString(),
    duration_seconds: durationSec,
    model_used: selectedModel,
    transcript: transcript || 'Обработка аудио...',
    summary: '',
    key_facts: {
      is_dispute: false,
      dispute_reason: null,
      promises: [],
      tone_client: 'нейтральный',
      tone_manager: 'нейтральный',
      call_outcome: 'успешно'
    },
    trigger_phrases: [],
    recommendations: [],
    operator_score: 10,
    operator_comment: '',
    client_name: client_name || 'Новый клиент',
    operator_name: operator_name || 'Менеджер салона',
    status: 'processing'
  };

  // Add processing entry
  db.calls.unshift(newCall);
  writeDb(db);

  try {
    const analysisResult = await analyzeCallTextOrAudio(
      selectedModel,
      transcript || '',
      audioBase64,
      false,
      durationSec
    );

    // Update in Db
    const updatedDb = readDb();
    const callIdx = updatedDb.calls.findIndex((c: any) => c.call_id === newCallId);
    
    if (callIdx !== -1) {
      const isFailed = isTechnicalErrorResult(analysisResult);
      updatedDb.calls[callIdx] = {
        ...updatedDb.calls[callIdx],
        ...analysisResult,
        status: isFailed ? 'failed' : 'completed'
      } as CallRecord;
      
      const savedCall = updatedDb.calls[callIdx];
      writeDb(updatedDb);

      // Trigger real-time toast notification for managers & admins
      notifyCallAnalyzed(savedCall);

      // Trigger automatic integrations ONLY on successful analysis
      if (!isFailed && savedCall.status === 'completed') {
        if (updatedDb.config.vk.enabled) {
          await sendToVk(savedCall, updatedDb.config.vk);
        }
        if (updatedDb.config.yclients.enabled) {
          await sendToYclients(savedCall, updatedDb.config.yclients);
        }
      }

      res.json(savedCall);
    } else {
      res.status(500).json({ error: 'Внутренняя ошибка базы данных' });
    }
  } catch (err: any) {
    const errorDb = readDb();
    const callIdx = errorDb.calls.findIndex((c: any) => c.call_id === newCallId);
    if (callIdx !== -1) {
      errorDb.calls[callIdx].status = 'failed';
      errorDb.calls[callIdx].error_message = err.message || String(err);
      writeDb(errorDb);
    }
    appendLog('error', 'system', `Ошибка во время анализа звонка ${newCallId}: ${err.message}`);
    res.status(500).json({ error: 'Ошибка во время анализа звонка', details: err.message });
  }
});

// Core reanalysis logic for a call (reusable by API and background worker)
async function performCallReanalysis(callId: string, modelOverride?: string): Promise<any> {
  const db = readDb();
  const callIdx = db.calls.findIndex((c: any) => c.call_id === callId);
  if (callIdx === -1) {
    throw new Error('Звонок не найден в базе данных');
  }

  const call = db.calls[callIdx];

  // If call duration is less than 10s or 0 or missed, do not attempt AI analysis
  if (call.duration_seconds < 10 || call.duration_seconds === 0 || call.is_answered === false || call.status === 'missed') {
    call.operator_score = null;
    call.status = call.duration_seconds === 0 ? 'missed' : 'completed';
    call.transcript = call.duration_seconds === 0
      ? 'Звонок не состоялся. Длительность разговора 00:00 (пропущенный вызов или сброс). Запись разговора и стенограмма отсутствуют.'
      : 'Разговор не состоялся (длительность менее 10 сек, диалог отсутствует).';
    call.summary = call.duration_seconds === 0
      ? (call.type === 'incoming' ? 'Пропущенный входящий звонок (00:00)' : 'Непринятый исходящий звонок (00:00)')
      : `Разговор не состоялся: длительность ${call.duration_seconds} сек (менее 10 секунд), диалог отсутствует.`;
    call.operator_comment = call.duration_seconds === 0
      ? 'Разговор не состоялся: длительность вызова 00:00.'
      : `Оценка не выставляется: разговор не состоялся (длительность ${call.duration_seconds} сек менее 10 секунд, диалог отсутствует).`;
    call.booking_status = 'не применимо';
    call.key_facts = {
      is_dispute: false,
      dispute_reason: null,
      promises: [],
      tone_client: 'нейтральный',
      tone_manager: 'нейтральный',
      call_outcome: 'не состоялся',
      booking_status: 'не применимо',
      client_issue: call.duration_seconds === 0 ? 'Звонок 00:00' : 'Звонок менее 10 секунд / диалог отсутствует'
    };
    call.recommendations = call.type === 'incoming'
      ? ['Рекомендуется перезвонить клиенту для уточнения цели обращения.']
      : ['Попробовать связаться с клиентом повторно в другое время.'];
    db.calls[callIdx] = call;
    writeDb(db);
    return call;
  }

  const isErroneousTranscript = !call.transcript ||
    call.transcript === 'Загрузка аудиозаписи...' ||
    call.transcript === 'Обработка аудио...' ||
    call.transcript.startsWith('Аудиозапись не была') ||
    call.transcript.startsWith('Стенограмма отсутствует') ||
    call.transcript.includes('не содержит разборчивой речи') ||
    call.transcript.includes('Стенограмма ожидает') ||
    call.transcript.includes('не была загружена') ||
    call.transcript.includes('предоставьте аудиозапись') ||
    call.transcript.includes('исчерпан лимит') ||
    call.transcript.includes('лимит токенов') ||
    call.transcript.includes('превышена квота') ||
    call.transcript.includes('resource_exhausted') ||
    call.transcript.includes('rate-limits') ||
    call.transcript.includes('Gemini') ||
    call.transcript.includes('Ошибка:') ||
    call.transcript.includes('отсутствует диалог') ||
    call.transcript.includes('Автоответчик:') ||
    call.transcript.includes('автоответчик') ||
    call.transcript.includes('Сработал автоответчик') ||
    call.transcript.includes('линия занята');

  // If the call has audio, prioritize fresh transcription, but retain valid existing transcript as fallback
  const existingTranscript = (!isErroneousTranscript && call.transcript && call.transcript.length > 20) ? call.transcript : '';

  const selectedModel = (modelOverride as GigaChatModel) || db.config.default_gigachat_model || db.config.activeModel || 'GigaChat:Lite';

  // Mark status as processing and record attempt metadata
  call.status = 'processing';
  call.transcript = existingTranscript || 'Загрузка аудиозаписи...';
  call.retry_count = (call.retry_count || 0) + 1;
  call.last_retry_at = new Date().toISOString();
  db.calls[callIdx] = call;
  writeDb(db);

  try {
    let audioUrl = call.audio_url;
    const megafonToken = db.config.megafon?.token;
    const cleanToken = megafonToken ? megafonToken.trim().replace(/^['"]|['"]$/g, '') : '';

    let audioBase64: { data: string; mimeType: string } | null = null;
    let audioDownloadFailed = false;

    // If it is a real Megafon call, lookup direct link ONLY if audioUrl is missing or is a web report link
    const needsLinkLookup = !audioUrl || 
                            audioUrl.includes('/reports/mgf_calls/') || 
                            audioUrl.includes('uuid=');
    if (callId.startsWith('megafon-real-') && cleanToken && needsLinkLookup) {
      const commId = callId.replace('megafon-real-', '');
      appendLog('info', 'megafon', `[Переанализ/Авто-Повтор] Поиск актуальной прямой ссылки для звонка ${commId}...`);
      const directLink = await findRealRecordingLinkFromApi(commId, cleanToken);
      if (directLink) {
        audioUrl = directLink;
      }
    }

    if (audioUrl) {
      appendLog('info', 'megafon', `[Переанализ/Авто-Повтор] Скачивание аудиозаписи с ${audioUrl}...`);
      audioBase64 = await downloadAudioAsBase64(audioUrl, megafonToken);
      if (!audioBase64) {
        audioDownloadFailed = true;
        appendLog('warning', 'megafon', `[Переанализ/Авто-Повтор] Не удалось скачать аудиозапись.`);
      } else {
        appendLog('success', 'megafon', `[Переанализ/Авто-Повтор] Аудиозапись успешно скачана.`);
      }
    } else {
      audioDownloadFailed = true;
    }

    const analysisResult = await analyzeCallTextOrAudio(
      selectedModel,
      existingTranscript,
      audioBase64 || undefined,
      audioDownloadFailed,
      call.duration_seconds
    );

    const finalDb = readDb();
    const finalCallIdx = finalDb.calls.findIndex((c: any) => c.call_id === callId);
    if (finalCallIdx !== -1) {
      const isFailed = (audioDownloadFailed && !existingTranscript) || isTechnicalErrorResult(analysisResult);
      finalDb.calls[finalCallIdx] = {
        ...finalDb.calls[finalCallIdx],
        ...analysisResult,
        status: isFailed ? 'failed' : 'completed',
        is_demo: false,
        model_used: selectedModel,
        gigachat_model: selectedModel.startsWith('GigaChat') ? (selectedModel as GigaChatModel) : 'GigaChat:Lite'
      };
      if (audioUrl) {
        finalDb.calls[finalCallIdx].audio_url = audioUrl;
      }
      const savedCall = finalDb.calls[finalCallIdx];
      writeDb(finalDb);

      // Trigger real-time toast notification for managers & admins
      notifyCallAnalyzed(savedCall);

      if (!isFailed && savedCall.status === 'completed') {
        // Trigger automatic integrations only upon successful processing
        if (finalDb.config.vk.enabled) {
          await sendToVk(savedCall, finalDb.config.vk);
        }
        if (finalDb.config.yclients.enabled) {
          await sendToYclients(savedCall, finalDb.config.yclients);
        }
      }

      return savedCall;
    } else {
      throw new Error('Внутренняя ошибка базы данных при сохранении результатов');
    }
  } catch (err: any) {
    const errorDb = readDb();
    const finalCallIdx = errorDb.calls.findIndex((c: any) => c.call_id === callId);
    if (finalCallIdx !== -1) {
      errorDb.calls[finalCallIdx].status = 'failed';
      errorDb.calls[finalCallIdx].error_message = err.message || String(err);
      writeDb(errorDb);
    }
    appendLog('error', 'system', `Ошибка во время анализа звонка ${callId}: ${err.message}`);
    throw err;
  }
}

// Batch re-analyze all un-transcribed calls or calls with audio (REST API)
app.post('/api/calls/batch-reanalyze', async (req, res) => {
  const userRole = getCurrentUserRole(req);
  if (userRole === 'viewer' || userRole === 'operator') {
    return res.status(403).json({ error: 'Недостаточно прав для пакетной обработки (доступно только Администраторам и Управляющим)' });
  }

  const db = readDb();
  const modelOverride = req.body?.model;

  const candidates = db.calls.filter((c: any) =>
    c.duration_seconds > 0 &&
    c.audio_url &&
    (
      !c.transcript ||
      c.transcript.length < 35 ||
      c.transcript.includes('Стенограмма ожидает') ||
      c.transcript.includes('не содержит разборчивой речи') ||
      c.transcript.includes('Загрузка аудиозаписи') ||
      c.operator_comment?.includes('Аудиозапись доступна в плеере') ||
      c.operator_comment?.includes('Сработал автоответчик') ||
      c.operator_comment?.includes('не состоялся') ||
      c.summary?.includes('доступна для прослушивания в плеере') ||
      c.status === 'failed' ||
      c.status === 'processing'
    )
  );

  appendLog('info', 'speechkit', `Запущен пакетный переанализ для ${candidates.length} звонков...`);

  // Start background queue processing
  (async () => {
    let successCount = 0;
    for (const c of candidates) {
      try {
        await performCallReanalysis(c.call_id, modelOverride);
        successCount++;
        await new Promise(r => setTimeout(r, 600));
      } catch (err: any) {
        console.warn(`[BatchReanalyze] Ошибка обработки звонка ${c.call_id}:`, err.message);
      }
    }
    appendLog('success', 'speechkit', `Пакетный переанализ завершен: успешно обработано ${successCount} из ${candidates.length} звонков.`);
  })();

  res.json({
    success: true,
    totalQueued: candidates.length,
    message: `Запущен фоновый переанализ для ${candidates.length} звонков через Yandex SpeechKit и GigaChat.`
  });
});

// 4. SIMULATE WEBHOOK FROM MEGAFON ATS (Section 2.1) - DISABLED PER CUSTOMER REQUEST
app.post('/api/calls/simulate-webhook', async (req, res) => {
  appendLog('warning', 'megafon', 'Запрос на симуляцию звонка отклонен: функция генерации тестовых звонков отключена.');
  return res.status(403).json({ error: 'Функция генерации тестовых и демо-звонков отключена.' });
});


// 5. GET LOGS (Admin only)
app.get('/api/logs', (req, res) => {
  const userRole = getCurrentUserRole(req);
  if (userRole !== 'admin') {
    return res.status(403).json({ error: 'Журнал системных логов доступен только администратору системы' });
  }
  const db = readDb();
  res.json(db.logs);
});

// 6. CLEAR LOGS (Admin only)
app.post('/api/logs/clear', (req, res) => {
  const userRole = getCurrentUserRole(req);
  if (userRole !== 'admin') {
    return res.status(403).json({ error: 'Очистка логов доступна только администратору системы' });
  }
  const db = readDb();
  db.logs = [
    {
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'info',
      module: 'system',
      message: 'Журнал аудита успешно очищен администратором.'
    }
  ];
  writeDb(db);
  res.json({ success: true });
});

// 7. GET CONFIG (Sensitive tokens masked for non-admins)
app.get('/api/config', (req, res) => {
  const db = readDb();
  const userRole = getCurrentUserRole(req);

  if (userRole === 'admin') {
    return res.json(db.config);
  }

  // Sanitize config for non-admin roles
  const safeConfig = {
    ...db.config,
    credentials: undefined, // strip credentials
    megafon: {
      ...db.config.megafon,
      token: '••••••••',
      lkPassword: '••••••••'
    },
    vk: {
      ...db.config.vk,
      token: '••••••••'
    },
    yclients: {
      ...db.config.yclients,
      userToken: '••••••••',
      partnerToken: '••••••••'
    }
  };

  res.json(safeConfig);
});

// 8. UPDATE CONFIG (Admin only)
app.post('/api/config', (req, res) => {
  const userRole = getCurrentUserRole(req);
  if (userRole !== 'admin') {
    return res.status(403).json({ error: 'Изменение настроек системы доступно только администратору' });
  }
  const db = readDb();
  const body = req.body || {};

  if (body.megafon) {
    if (body.megafon.pollingIntervalMinutes !== undefined) {
      const parsed = parseInt(String(body.megafon.pollingIntervalMinutes), 10);
      body.megafon.pollingIntervalMinutes = isNaN(parsed) ? 5 : Math.max(1, parsed);
    }
  }

  db.config = {
    ...db.config,
    ...body,
    megafon: {
      ...db.config.megafon,
      ...(body.megafon || {})
    },
    vk: {
      ...db.config.vk,
      ...(body.vk || {})
    },
    yclients: {
      ...db.config.yclients,
      ...(body.yclients || {})
    }
  };

  writeDb(db);
  appendLog('info', 'system', `Конфигурация системы успешно обновлена. Интервал авто-опроса АТС: ${db.config.megafon.pollingIntervalMinutes} мин. (автоопрос: ${db.config.megafon.pollingEnabled ? 'включен' : 'выключен'})`);
  res.json(db.config);
});

// 8.1. Non-Russian model test endpoints disabled per 152-FZ sovereign regulation
app.post("/api/openrouter/test", async (_req, res) => {
  return res.status(400).json({ success: false, error: "В приложении поддерживаются исключительно отечественные модели (Сбер GigaChat, Yandex Cloud)." });
});

app.post("/api/routerai/test", async (_req, res) => {
  return res.status(400).json({ success: false, error: "В приложении поддерживаются исключительно отечественные модели (Сбер GigaChat, Yandex Cloud)." });
});

// 8.3. TEST GIGACHAT CONNECTION (Russian Sovereign LLM)
app.post('/api/gigachat/test', async (req, res) => {
  const { model } = req.body || {};
  const targetModel: GigaChatModel = model || 'GigaChat:Lite';
  appendLog('info', 'gigachat', `Тестирование соединения с Сбер GigaChat API (${targetModel})...`);

  try {
    const testSample = 'Менеджер: Добрый день, салон красоты «Лик 28». Клиент: Здравствуйте, хочу узнать стоимость стрижки.';
    const result = await analyzeWithRetry(testSample, targetModel, (type, msg) => appendLog(type, 'gigachat', msg));
    appendLog('success', 'gigachat', `Тест подключения к GigaChat (${targetModel}) успешен!`);
    return res.json({
      success: true,
      message: `Соединение с GigaChat успешно! Модель ${targetModel} работает корректно.`,
      queue: getGigaChatQueueStatus(),
      data: result
    });
  } catch (err: any) {
    appendLog('error', 'gigachat', `Ошибка подключения к GigaChat: ${err.message}`);
    res.status(500).json({ success: false, error: err.message || 'Ошибка подключения к GigaChat', queue: getGigaChatQueueStatus() });
  }
});

// 8.3.1. GIGACHAT QUEUE STATUS
app.get('/api/gigachat/queue', (req, res) => {
  res.json({
    status: 'ok',
    queue: getGigaChatQueueStatus(),
    configured: isGigaChatConfigured()
  });
});

// 8.4. TEST YANDEX SPEECHKIT CONNECTION (Russian Sovereign STT)
app.post('/api/speechkit/test', async (req, res) => {
  appendLog('info', 'speechkit', 'Проверка конфигурации авторизации Yandex Cloud SpeechKit (152-ФЗ)...');
  try {
    const isConfigured = isYandexAuthConfigured();
    if (!isConfigured) {
      appendLog('warning', 'speechkit', 'Сервисный аккаунт Yandex Cloud не настроен (отсутствует authorized_key.json или YC_API_KEY).');
      return res.json({
        success: false,
        configured: false,
        message: 'Сервисный аккаунт Yandex Cloud не настроен. Проверьте монтирование authorized_key.json или переменные окружения.'
      });
    }

    appendLog('success', 'speechkit', 'Авторизация Yandex Cloud настроена корректно.');
    res.json({
      success: true,
      configured: true,
      message: 'Авторизация Yandex Cloud SpeechKit готова к работе.'
    });
  } catch (err: any) {
    appendLog('error', 'speechkit', `Ошибка проверки SpeechKit: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 8.5. TRIGGER 152-ФЗ DATA RETENTION CLEANUP
app.post('/api/cleanup/trigger', async (req, res) => {
  appendLog('info', 'cleanup', 'Ручной запуск регламентного удаления устаревших персональных данных по 152-ФЗ...');
  try {
    const result = await runCleanupNow();
    appendLog('success', 'cleanup', `Очистка завершена: удалено аудиозаписей ${result.audioRemoved}, стенограмм ${result.contentRemoved}, логов ${result.logsCleaned}, файлов ${result.tempFilesCleaned}`);
    res.json({
      success: true,
      result
    });
  } catch (err: any) {
    appendLog('error', 'cleanup', `Ошибка при выполнении очистки: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. MANUAL MANIPULATIONS (Send VK / Send Yclients)
app.post('/api/calls/:id/send-vk', async (req, res) => {
  const userRole = getCurrentUserRole(req);
  if (userRole === 'viewer' || userRole === 'operator') {
    return res.status(403).json({ error: 'Недостаточно прав для отправки уведомлений в VK (только Администратор и Управляющий)' });
  }
  const db = readDb();
  const call = db.calls.find((c: any) => c.call_id === req.params.id);
  if (!call) {
    return res.status(404).json({ error: 'Звонок не найден' });
  }
  const force = req.query.force === 'true' || req.body?.force === true || true; // Manual direct button click forces sending
  const result = await sendToVk(call, db.config.vk, force);
  res.json(result);
});

app.post('/api/calls/:id/send-yclients', async (req, res) => {
  const userRole = getCurrentUserRole(req);
  if (userRole === 'viewer' || userRole === 'operator') {
    return res.status(403).json({ error: 'Недостаточно прав для передачи в YClients (только Администратор и Управляющий)' });
  }
  const db = readDb();
  const call = db.calls.find((c: any) => c.call_id === req.params.id);
  if (!call) {
    return res.status(404).json({ error: 'Звонок не найден' });
  }
  const success = await sendToYclients(call, db.config.yclients);
  res.json({ success });
});

// 10. RE-SEED / SEED DEMO CALLS
app.post('/api/calls/create-demo', (req, res) => {
  res.status(403).json({ success: false, error: 'Функция генерации демонстрационных звонков отключена.' });
});

// 11. STATS CALCULATION
app.get('/api/stats', (req, res) => {
  const db = readDb();
  const calls: CallRecord[] = db.calls.filter((c: any) => c.status === 'completed');
  
  if (calls.length === 0) {
    return res.json({
      totalCalls: 0,
      disputeRate: 0,
      averageScore: 0,
      successRate: 0,
      toneStats: {
        client: { neutral: 0, discontent: 0, aggressive: 0 },
        manager: { neutral: 0, calm: 0, defensive: 0 }
      }
    });
  }

  const total = calls.length;
  const disputes = calls.filter(c => c.key_facts.is_dispute).length;
  const totalScore = calls.reduce((acc, c) => acc + c.operator_score, 0);
  const success = calls.filter(c => c.key_facts.call_outcome === 'успешно').length;

  const tone_client = { neutral: 0, discontent: 0, aggressive: 0 };
  const tone_manager = { neutral: 0, calm: 0, defensive: 0 };

  calls.forEach(c => {
    // Client tone mapping
    if (c.key_facts.tone_client === 'нейтральный') tone_client.neutral++;
    else if (c.key_facts.tone_client === 'недовольный') tone_client.discontent++;
    else if (c.key_facts.tone_client === 'агрессивный') tone_client.aggressive++;

    // Manager tone mapping
    if (c.key_facts.tone_manager === 'нейтральный') tone_manager.neutral++;
    else if (c.key_facts.tone_manager === 'спокойный') tone_manager.calm++;
    else if (c.key_facts.tone_manager === 'оборонительный') tone_manager.defensive++;
  });

  // Calculate Hourly Stats (Europe/Samara, UTC+4)
  const hourlyMap: Record<number, { total: number; booked: number; declined: number; consultation: number; disputes: number; totalScore: number; scoreCount: number; missed: number }> = {};
  for (let h = 0; h < 24; h++) {
    hourlyMap[h] = { total: 0, booked: 0, declined: 0, consultation: 0, disputes: 0, totalScore: 0, scoreCount: 0, missed: 0 };
  }

  // Include all calls (both completed and missed for peak load estimation)
  const allCallsForHourly: any[] = db.calls || [];
  allCallsForHourly.forEach((c: any) => {
    try {
      const d = new Date(c.timestamp);
      if (isNaN(d.getTime())) return;
      const samaraHour = (d.getUTCHours() + 4) % 24;
      const entry = hourlyMap[samaraHour];
      if (!entry) return;

      entry.total++;
      if (c.status === 'missed') {
        entry.missed++;
      }
      const outcome = (c.key_facts?.call_outcome || '').toLowerCase();
      const booking = (c.booking_status || c.key_facts?.booking_status || '').toLowerCase();
      if (booking === 'согласие' || outcome === 'запись') {
        entry.booked++;
      } else if (booking === 'отказ' || outcome === 'отказ') {
        entry.declined++;
      } else {
        entry.consultation++;
      }
      if (c.key_facts?.is_dispute) {
        entry.disputes++;
      }
      if (typeof c.operator_score === 'number' && !isNaN(c.operator_score)) {
        entry.totalScore += c.operator_score;
        entry.scoreCount++;
      }
    } catch {
      // ignore date errors
    }
  });

  const hourlyStats = Object.keys(hourlyMap).map((hStr) => {
    const h = parseInt(hStr, 10);
    const item = hourlyMap[h];
    return {
      hour: h,
      label: `${h < 10 ? '0' : ''}${h}:00`,
      total: item.total,
      booked: item.booked,
      declined: item.declined,
      consultation: item.consultation,
      disputes: item.disputes,
      missed: item.missed,
      avgScore: item.scoreCount > 0 ? Number((item.totalScore / item.scoreCount).toFixed(1)) : 0,
    };
  });

  // Calculate Daily Sentiment & Loyalty Trends (Europe/Samara, UTC+4)
  const daySentimentMap: Record<string, {
    dateKey: string;
    total: number;
    positive: number;
    negative: number;
    neutral: number;
    disputes: number;
    totalScore: number;
    scoreCount: number;
    dObj: Date;
  }> = {};

  allCallsForHourly.forEach((c: any) => {
    try {
      const d = new Date(c.timestamp);
      if (isNaN(d.getTime())) return;
      const samaraDate = new Date(d.getTime() + 4 * 3600 * 1000);
      const dateKey = samaraDate.toISOString().slice(0, 10);

      if (!daySentimentMap[dateKey]) {
        daySentimentMap[dateKey] = {
          dateKey,
          total: 0,
          positive: 0,
          negative: 0,
          neutral: 0,
          disputes: 0,
          totalScore: 0,
          scoreCount: 0,
          dObj: samaraDate,
        };
      }

      const entry = daySentimentMap[dateKey];
      entry.total++;

      const tc = (c.key_facts?.tone_client || '').toLowerCase();
      const score = typeof c.operator_score === 'number' && !isNaN(c.operator_score) ? c.operator_score : null;
      const isDispute = !!c.key_facts?.is_dispute;
      if (isDispute) entry.disputes++;

      if (score !== null) {
        entry.totalScore += score;
        entry.scoreCount++;
      }

      const isNegative = isDispute ||
        ['раздраженный', 'недовольный', 'агрессивный', 'конфликтный', 'грубый'].some(t => tc.includes(t)) ||
        (score !== null && score > 0 && score <= 4);

      const isPositive = !isNegative && (
        ['дружелюбный', 'позитивный', 'благодарный', 'радостный', 'довольный'].some(t => tc.includes(t)) ||
        (score !== null && score >= 8) ||
        (c.booking_status === 'согласие' || c.key_facts?.call_outcome === 'запись')
      );

      if (isNegative) {
        entry.negative++;
      } else if (isPositive) {
        entry.positive++;
      } else {
        entry.neutral++;
      }
    } catch {
      // ignore date errors
    }
  });

  const sortedDays = Object.values(daySentimentMap).sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  const russianDayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
  const russianMonthNames = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  const sentimentTrends = sortedDays.map((d) => {
    const dParts = new Date(d.dateKey + 'T12:00:00Z');
    const dayOfWeek = russianDayNames[dParts.getUTCDay()];
    const dayNum = dParts.getUTCDate();
    const month = russianMonthNames[dParts.getUTCMonth()];

    const posPct = d.total > 0 ? Math.round((d.positive / d.total) * 100) : 0;
    const negPct = d.total > 0 ? Math.round((d.negative / d.total) * 100) : 0;
    const neuPct = d.total > 0 ? Math.max(0, 100 - posPct - negPct) : 0;
    const nsi = posPct - negPct;
    const avgScore = d.scoreCount > 0 ? Number((d.totalScore / d.scoreCount).toFixed(1)) : null;

    return {
      dateKey: d.dateKey,
      label: `${dayOfWeek}, ${dayNum} ${month}`,
      shortLabel: `${dayNum} ${month}`,
      dayOfWeek,
      total: d.total,
      positive: d.positive,
      negative: d.negative,
      neutral: d.neutral,
      posPct,
      negPct,
      neuPct,
      nsi,
      avgScore,
      disputes: d.disputes,
    };
  });

  const stats: DashboardStats = {
    totalCalls: total,
    disputeRate: Math.round((disputes / total) * 100),
    averageScore: Number((totalScore / total).toFixed(1)),
    successRate: Math.round((success / total) * 100),
    toneStats: {
      client: tone_client,
      manager: tone_manager
    },
    hourlyStats,
    sentimentTrends
  };

  res.json(stats);
});

// Serve Frontend Vite bundle in production / fallback routing
async function startServer() {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Initialize 152-ФЗ automatic data retention cleanup scheduler
  try {
    initCleanupScheduler();
    console.log('[152-ФЗ] Регламентный планировщик очистки ПДн запущен');
  } catch (cleanErr: any) {
    console.error('[152-ФЗ] Ошибка запуска планировщика очистки:', cleanErr.message);
  }

  // 152-ФЗ: Синхронизация реестра согласий со всеми звонками в базе
  try {
    const db = readDb();
    if (db.calls && Array.isArray(db.calls) && db.calls.length > 0) {
      syncConsentsFromCalls(db.calls).then(count => {
        if (count > 0) {
          writeDb(db);
          console.log(`[152-ФЗ] Реестр согласий синхронизирован: добавлено ${count} записей`);
        }
      }).catch(err => {
        console.error('[152-ФЗ] Ошибка фоновой синхронизации согласий:', err.message);
      });
    }
  } catch (syncErr: any) {
    console.error('[152-ФЗ] Ошибка инициализации сверки согласий:', syncErr.message);
  }

  // Automatic cleanup of legacy duplicated transcripts (SpeechKit mono echo)
  try {
    const db = readDb();
    let fixedCount = 0;
    if (db.calls && Array.isArray(db.calls)) {
      for (const call of db.calls) {
        if (call.transcript) {
          const cleaned = refineTranscriptRoles(fixDuplicatedTranscript(call.transcript));
          if (cleaned !== call.transcript) {
            call.transcript = cleaned;
            fixedCount++;
          }
        }

        // Авто-исправление резюме для звонка с отказом клиента из-за отъезда
        if (call.call_id === 'megafon-real-84462946' && call.summary && (call.summary.includes('ближайшая доступная запись была на завтра') || call.key_facts?.call_outcome === 'запись')) {
          console.log('[Migration] Обнаружен звонок megafon-real-84462946 с устаревшим резюме. Запуск авто-обновления через GigaChat...');
          const anonymized = anonymizeTranscript(call.transcript);
          analyzeWithRetry(anonymized, 'GigaChat:Lite', (l, m) => console.log(`[GigaChat AutoSync] ${m}`))
            .then(analysis => {
              const updatedDb = readDb();
              const idx = updatedDb.calls.findIndex((c: any) => c.call_id === 'megafon-real-84462946');
              if (idx !== -1) {
                updatedDb.calls[idx].summary = analysis.transcript_summary;
                updatedDb.calls[idx].booking_status = analysis.booking_status || analysis.key_facts?.booking_status;
                if (analysis.formatted_transcript) {
                  updatedDb.calls[idx].transcript = analysis.formatted_transcript;
                }
                updatedDb.calls[idx].key_facts = {
                  ...analysis.key_facts,
                  booking_status: analysis.booking_status || analysis.key_facts?.booking_status,
                  promises: updatedDb.calls[idx].key_facts?.promises || []
                };
                updatedDb.calls[idx].operator_score = analysis.operator_score;
                updatedDb.calls[idx].operator_comment = analysis.operator_comment;
                updatedDb.calls[idx].recommendations = Array.isArray(analysis.recommendations) ? analysis.recommendations : [analysis.recommendations];
                writeDb(updatedDb);
                console.log('[Migration] Резюме и итог звонка megafon-real-84462946 успешно актуализированы в базе данных!');
              }
            })
            .catch(err => console.error('[Migration] Ошибка обновления анализа megafon-real-84462946:', err.message));
        }

        // Авто-исправление звонков с ошибками токенов, ложным автоответчиком или placeholder-текстом
        if (
          (call.duration_seconds > 0 || call.audio_url || call.is_answered) &&
          (
            call.summary?.includes('не содержит разборчивой речи') ||
            call.summary?.includes('не была загружена') ||
            call.summary?.includes('Анализ звонка заблокирован') ||
            call.transcript?.includes('не содержит разборчивой речи') ||
            call.transcript?.includes('не была загружена') ||
            call.transcript?.includes('исчерпан лимит') ||
            call.transcript?.includes('Gemini') ||
            call.transcript?.includes('Ошибка:') ||
            call.transcript?.includes('лимит токенов') ||
            call.operator_comment?.includes('Вместо аудиозаписи был передан системный код') ||
            call.operator_comment?.includes('Сработал автоответчик или короткое соединение') ||
            call.operator_comment?.includes('по технической причине')
          )
        ) {
          call.summary = 'Аудиозапись звонка доступна для прослушивания в плеере. Стенограмма ожидает распознавания речи.';
          call.transcript = 'Стенограмма ожидает расшифровки. Аудиозапись доступна в плеере.';
          call.operator_comment = 'Аудиозапись доступна в плеере. Оценка работы оператора ожидает распознавания речи.';
          call.status = 'completed';
          fixedCount++;
        }
      }
      if (fixedCount > 0) {
        writeDb(db);
        console.log(`[Migration] Успешно нормализованы статусы в ${fixedCount} звонках без вызова внешних квот.`);
      }
    }
  } catch (mErr: any) {
    console.error('[Migration] Ошибка миграции дублированных стенограмм:', mErr.message);
  }

  // Hydrate database from S3 timeweb.cloud if configured
  performS3Hydration().catch(err => console.error('[S3 Boot Sync Error]', err));

  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(DIST_PATH));
    app.get('*', (req, res) => {
      const indexPath = path.join(DIST_PATH, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Сборка приложения не найдена. Пожалуйста, выполните "npm run build".');
      }
    });
  } else {
    try {
      const { createServer: createViteServer } = await import('vite');
      const viteServer = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa'
      });
      app.use(viteServer.middlewares);
    } catch (err) {
      console.error('Не удалось запустить Vite dev server:', err);
    }
  }
}

startServer();
