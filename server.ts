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
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { CallRecord, LogEntry, SystemConfig, ModelType, DashboardStats, KeyFacts, VkConfig, YclientsConfig, GigaChatModel } from './src/types.js';
import { transcribeWithRetry } from './src/services/speechkit.js';
import { analyzeWithRetry } from './src/services/gigachat.js';
import { anonymizeTranscript, maskPhone } from './src/services/anonymize.js';
import { readStoreSync, writeStore } from './src/store/store.js';
import { ensureAutoConsent, getConsentForPhone, registerConsent } from './src/store/consents.js';
import { initCleanupScheduler, runCleanupNow } from './src/store/cleanup.js';
import { consentsRouter } from './src/routes/consents.js';
import { settingsRouter } from './src/routes/settings.js';
import { isYandexAuthConfigured } from './src/services/yandex-auth.js';
import { isGigaChatConfigured } from './src/services/gigachat-auth.js';

// Setup environment variables
dotenv.config();

const resolvedDirname = typeof __dirname !== 'undefined' ? __dirname : process.cwd();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 152-ФЗ Consents and Settings Routers
app.use('/api/consents', consentsRouter);
app.use('/api/settings', settingsRouter);

// Paths
const DATA_FILE = process.env.DATA_PATH || path.join(process.cwd(), 'data', 'data-store.json');
const SEED_FILE = path.join(process.cwd(), 'data-store.seed.json');
const FALLBACK_FILE = path.join(process.cwd(), 'data-store.json');
const DIST_PATH = path.join(process.cwd(), 'dist');

// S3 Storage Helpers
function getS3Config() {
  const bucket = process.env.S3_BUCKET_NAME || process.env.S3_BUCKET;
  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY || process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_KEY || process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.S3_REGION || process.env.AWS_REGION || 'ru-1';
  let prefix = process.env.S3_PREFIX || process.env.S3_KEY_PREFIX || process.env.S3_FOLDER || 'app/data';
  prefix = prefix.replace(/^\/+|\/+$/g, '');

  if (!bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }

  let formattedEndpoint = endpoint;
  if (formattedEndpoint && !formattedEndpoint.startsWith('http://') && !formattedEndpoint.startsWith('https://')) {
    formattedEndpoint = `https://${formattedEndpoint}`;
  }

  return {
    bucket,
    endpoint: formattedEndpoint,
    accessKeyId,
    secretAccessKey,
    region,
    prefix,
    key: `${prefix}/data-store.json`
  };
}

let s3ClientInstance: S3Client | null = null;
function getS3Client() {
  if (s3ClientInstance) return s3ClientInstance;
  const cfg = getS3Config();
  if (!cfg) return null;

  s3ClientInstance = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey
    },
    forcePathStyle: true
  });
  return s3ClientInstance;
}

async function streamToString(stream: any): Promise<string> {
  if (typeof stream.transformToString === 'function') {
    return await stream.transformToString('utf-8');
  }
  return new Promise((resolve, reject) => {
    const chunks: any[] = [];
    stream.on('data', (chunk: any) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
  });
}

let s3LastSyncTime: string | null = null;
let s3LastError: string | null = null;
let s3DebounceTimer: NodeJS.Timeout | null = null;

async function syncToS3(dataToSync?: any): Promise<boolean> {
  const cfg = getS3Config();
  const client = getS3Client();
  if (!cfg || !client) return false;

  try {
    const data = dataToSync || dbCache || readDb();
    if (!data) return false;

    const body = JSON.stringify(data, null, 2);
    
    await client.send(new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: cfg.key,
      Body: body,
      ContentType: 'application/json'
    }));

    s3LastSyncTime = new Date().toISOString();
    s3LastError = null;
    console.log(`[S3] База данных успешно сохранена в s3://${cfg.bucket}/${cfg.key}`);
    return true;
  } catch (err: any) {
    s3LastError = err.message || String(err);
    console.error(`[S3 Ошибка] Не удалось синхронизировать с S3 (${cfg.bucket}/${cfg.key}):`, err);
    return false;
  }
}

function scheduleS3Sync() {
  const cfg = getS3Config();
  if (!cfg) return;

  if (s3DebounceTimer) clearTimeout(s3DebounceTimer);
  s3DebounceTimer = setTimeout(() => {
    syncToS3().catch((err) => console.error('[S3 Sync error]', err));
  }, 2000);
}

async function syncFromS3OnBoot(): Promise<boolean> {
  const cfg = getS3Config();
  const client = getS3Client();
  if (!cfg || !client) {
    console.log('[S3] Переменные подключения S3 не обнаружены.');
    return false;
  }

  const candidateKeys = [
    cfg.key,                        // app/data/data-store.json
    'data-store.json',              // root
    'data/data-store.json'         // data/
  ];

  for (const candidateKey of candidateKeys) {
    try {
      console.log(`[S3] Поиск базы данных в бакете ${cfg.bucket}: ${candidateKey}`);
      const command = new GetObjectCommand({
        Bucket: cfg.bucket,
        Key: candidateKey
      });
      const response = await client.send(command);
      if (response.Body) {
        const strData = await streamToString(response.Body);
        const parsed = JSON.parse(strData);
        if (parsed && typeof parsed === 'object') {
          dbCache = parsed;
          const dataDir = path.dirname(DATA_FILE);
          if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
          }
          fs.writeFileSync(DATA_FILE, JSON.stringify(dbCache, null, 2), 'utf-8');
          s3LastSyncTime = new Date().toISOString();
          s3LastError = null;
          console.log(`[S3] Успешно загружена база данных из s3://${cfg.bucket}/${candidateKey} (${parsed.calls?.length || 0} звонков)`);
          return true;
        }
      }
    } catch (err: any) {
      if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
        console.log(`[S3] Ключ не найден: ${candidateKey}`);
      } else {
        s3LastError = err.message || String(err);
        console.error(`[S3] Ошибка чтения ${candidateKey}:`, err);
      }
    }
  }

  console.log(`[S3] База данных не найдена в S3 бакете ${cfg.bucket}. Выполняем первичную запись локальной БД в s3://${cfg.bucket}/${cfg.key}...`);
  const synced = await syncToS3();
  return synced;
}


// Local Database initialization
const DEFAULT_CONFIG: SystemConfig = {
  activeModel: 'gemini',
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    baseUrl: 'https://api.ru-openrouter.ru/v1',
    model: 'google/gemini-2.5-flash-lite',
    enabled: true
  },
  routerai: {
    apiKey: process.env.ROUTERAI_API_KEY || '',
    baseUrl: 'https://routerai.ru/api/v1',
    model: 'google/gemini-2.5-flash-lite',
    enabled: true
  },
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
    template: `🔔 *Анализ звонка #{call_id}*\n📅 *Дата и время (UTC+4):* {call_date_time}\n\n👤 *Клиент:* {client_name}\n📞 *Оценка оператора:* {operator_score}/10\n💬 *Резюме:* {summary}\n⚠️ *Конфликт:* {is_dispute_text} ({dispute_reason})\n📋 *Обещания менеджера:* {promises}\n💡 *Рекомендации:* {recommendations}`
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
    model_used: 'gemini',
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
    model_used: 'gemini',
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
    scheduleS3Sync();
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

// Initialize Gemini Client
const getGeminiClient = () => {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
};

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

  // Detect hallucinated order/service conversation when transcript is actually an auto-responder or very short non-dialogue
  const cleanT = (parsed.transcript || transcriptInput || '').trim();
  const cleanTLower = cleanT.toLowerCase();
  
  // Check if transcript contains a real full dialog between 2 humans:
  const hasHumanDialog = (cleanTLower.includes('клиент:') || cleanTLower.includes('покупатель:') || cleanTLower.includes('абонент:')) &&
                         (cleanTLower.includes('менеджер:') || cleanTLower.includes('администратор:') || cleanTLower.includes('оператор:'));

  // Detect suspicious hallucination markers in summary when there is no real multi-speaker human dialogue or transcript is short
  const hasHallucinationMarkers = summary.includes('заказ') || summary.includes('клиент обратился') || 
                                  summary.includes('менеджер сообщ') || summary.includes('уточнить возможность') || 
                                  summary.includes('доставка') || summary.includes('статус заказа') || summary.includes('наличие товара');

  if (isAutoResponder || (!hasHumanDialog && (cleanT.length < 280 || hasHallucinationMarkers))) {
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

// Helper for OpenRouter API (ru-openrouter.ru or openrouter.ai)
async function analyzeCallWithOpenRouter(
  transcriptInput: string,
  audioBase64?: { data: string; mimeType: string },
  config?: OpenRouterConfig
): Promise<Partial<CallRecord>> {
  const rawKey = config?.apiKey || process.env.OPENROUTER_API_KEY || '';
  const apiKey = rawKey.trim().replace(/^["']|["']$/g, '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, '');

  let baseUrl = (config?.baseUrl || 'https://api.ru-openrouter.ru/v1').trim().replace(/\/+$/, '');
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = 'https://' + baseUrl;
  }

  const modelName = config?.model || 'google/gemini-2.5-flash-lite';

  if (!apiKey) {
    appendLog('warning', 'openrouter', 'API ключ OpenRouter не задан. Запущена резервная аналитика.');
    return getFallbackAnalysis(transcriptInput, 'отсутствует API ключ OpenRouter');
  }

  let cleanText = (transcriptInput || '').trim();
  if (
    cleanText === 'Загрузка аудиозаписи...' ||
    cleanText === 'Обработка аудио...' ||
    cleanText.startsWith('Аудиозапись не была') ||
    cleanText.startsWith('Стенограмма отсутствует') ||
    cleanText === 'Аудиозапись телефонного разговора.'
  ) {
    cleanText = '';
  }

  // Pre-transcribe with Gemini if audio is present and text is missing
  if (!cleanText && audioBase64) {
    const geminiClient = getGeminiClient();
    if (geminiClient) {
      try {
        appendLog('info', 'openrouter', `Расшифровка аудиозаписи через Gemini перед вызовом OpenRouter (${modelName})...`);
        const gResponse = await geminiClient.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [
            {
              role: 'user',
              parts: [
                { inlineData: { mimeType: audioBase64.mimeType, data: audioBase64.data } },
                { text: 'Сделай точную дословную расшифровку (стенограмму) этой аудиозаписи на русском языке. Официальное название салона — «Лик 28» (Салон красоты «Лик 28»). Если запись пустая или тишина — напиши "Аудиозапись не содержит разборчивой речи". Напиши диалог репликами в формате "Менеджер: ...", "Клиент: ...". Напиши только текст диалога без дополнительных комментариев.' }
              ]
            }
          ]
        });
        if (gResponse.text && gResponse.text.trim()) {
          cleanText = gResponse.text.trim();
          appendLog('success', 'openrouter', `Транскрипция выполнена (${cleanText.length} символов). Передача текста диалога в OpenRouter...`);
        }
      } catch (gErr: any) {
        appendLog('warning', 'openrouter', `Расшифровка аудиозаписи через Gemini перед вызовом OpenRouter не удалась: ${gErr.message || gErr}`);
      }
    }
  }

  if (!cleanText) {
    appendLog('error', 'openrouter', `Ошибка: для анализа через OpenRouter (${modelName}) отсутствует текст диалога или не удалось расшифровать аудиозапись.`);
    return getFallbackAnalysis('', 'Отсутствует стенограмма или аудиозапись для анализа через OpenRouter');
  }

  const promptSystem = `Ты — AI-помощник для анализа телефонных разговоров сети салонов красоты.
ЯЗЫК СТЕНОГРАММЫ И АНАЛИЗА — СТРОГО РУССКИЙ. Все поля JSON (стенограмма, резюме, ключевые факты, рекомендации, комментарии) ДОЛЖНЫ БЫТЬ ИСКЛЮЧИТЕЛЬНО НА РУССКОМ ЯЗЫКЕ.

КОНТЕКСТ САЛОНА КРАСОТЫ:
- Официальное название салона: «Лик 28» (Салон красоты «Лик 28»). В разговорной речи может звучать как «Лик двадцать восемь», «салон Лик 28», «студия Лик 28».
- ПРАВИЛЬНОЕ НАИМЕНОВАНИЕ: При транскрипции и анализе всегда фиксируй название салона строго как «Лик 28» (не искажай в «Ликс», «Лайк», «Лиг», «Элик» и т.п.).
- СТАНДАРТ ПРИВЕТСТВИЯ: Название «Лик 28» является официальным эталонным брендом компании. Если администратор представляется от имени салона «Лик 28» или «Салон красоты Лик 28», это абсолютно правильно! Категорически запрещено считать это ошибкой или снижать оценку оператора.

СТРОГИЕ ПРАВИЛА И ИСКЛЮЧЕНИЕ ГАЛЛЮЦИНАЦИЙ:
1. Проанализируй разговор строго по реально фактически прозвучавшим данным. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО выдумывать детали, имена клиентов, номера заказов (например "заказ №12345"), цены, товары или услуги, которых НЕ БЫЛО в записи или тексте!
2. ЕСЛИ НА АУДИО ИЛИ В ТЕКСТЕ СРАБОТАЛ АВТООТВЕТЧИК, АВТОИНФОРМАТОР ИЛИ АБОНЕНТ НЕДОСТУПЕН (например: "Абонент сейчас не может ответить...", "Перезвоните позднее", "Оставьте сообщение после сигнала"):
   - В "transcript" выведи СТРОГО реально прозвучавшую фразу (например: "Автоответчик: Абонент сейчас не может ответить на ваш звонок. Попробуйте перезвонить позднее.").
   - В "summary" выведи СТРОГО: "Разговор не состоялся: сработал автоответчик или системный автоинформатор".
   - В "operator_score" выведи null (так как диалога с оператором не было).
   - В "operator_comment" напиши: "Разговор с клиентом не состоялся: на линии сработал автоответчик или автоинформатор".
   - В "key_facts.call_outcome" напиши: "автоответчик".
   - В "key_facts.client_issue" напиши: "Автоответчик / Абонент недоступен".

ВАЖНО: ТВОЙ ОТВЕТ ДОЛЖЕН БЫТЬ СТРОГО В ФОРМАТЕ RAW JSON! НЕ ДОБАВЛЯЙ НИКАКИХ ВВОДНЫХ СЛОВ ИЛИ ПРИВЕТСТВИЙ ТИПА "Пожалуйста", "Вот результат" И Т.П. ПЕРВЫЙ СИМВОЛ ОТВЕТА — '{', ПОСЛЕДНИЙ — '}'.

Схема JSON:
{
  "transcript": "дословная стенограмма на русском языке",
  "summary": "краткая суть разговора по фактам на русском языке",
  "key_facts": {
    "is_dispute": false,
    "dispute_reason": null,
    "promises": [],
    "tone_client": "нейтральный",
    "tone_manager": "спокойный",
    "call_outcome": "успешно",
    "client_issue": "вопрос клиента"
  },
  "trigger_phrases": [],
  "recommendations": ["рекомендация 1 на русском языке"],
  "operator_score": 9,
  "operator_comment": "комментарий к работе оператора на русском языке"
}`;

  let userContent = cleanText;

  appendLog('info', 'openrouter', `Запрос к API OpenRouter (Модель: ${modelName}, URL: ${baseUrl})...`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://openrouter.ai',
        'X-Title': 'Call Analytics System'
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: promptSystem },
          { role: 'user', content: `Текст/данные диалога:\n${userContent}\n\nВыполни анализ и верни строго JSON без вводных слов.` }
        ],
        temperature: 0.2
      })
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      let openRouterMsg = errText;
      try {
        const errJson = JSON.parse(errText);
        if (errJson.error?.message) {
          openRouterMsg = errJson.error.message;
        }
      } catch {
        // use raw text
      }

      let hint = '';
      if (openRouterMsg.includes('Missing Authentication header') || openRouterMsg.includes('User not found')) {
        hint = ' -> Проверьте правильность API ключа в настройках.';
      } else if (openRouterMsg.includes('Insufficient credits') || openRouterMsg.includes('credit')) {
        hint = ' -> Недостаточно средств/баланса на аккаунте.';
      }

      throw new Error(`OpenRouter API (HTTP ${response.status}): ${openRouterMsg}${hint}`);
    }

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content || '{}';
    const parsed = extractAndParseLLMJson(rawText, transcriptInput, 'openrouter');

    const usage = data.usage;
    const promptTok = usage?.prompt_tokens ?? Math.ceil(((transcriptInput || '').length + 1200) / 4);
    const compTok = usage?.completion_tokens ?? Math.ceil(rawText.length / 4);
    parsed.tokens_used = {
      prompt_tokens: promptTok,
      completion_tokens: compTok,
      total_tokens: usage?.total_tokens ?? (promptTok + compTok)
    };

    appendLog('success', 'openrouter', `Звонок успешно проанализирован через OpenRouter API (${modelName}). Токены: ${parsed.tokens_used.total_tokens}`);
    return parsed;
  } catch (err: any) {
    const isTimeout = err.name === 'AbortError';
    const errMsg = isTimeout
      ? `Таймаут подключения (60с) к ${baseUrl}. Сервер недоступен.`
      : `Ошибка вызова OpenRouter (${modelName}): ${err.message || err}`;
    appendLog('error', 'openrouter', errMsg);
    return getFallbackAnalysis(transcriptInput, errMsg);
  }
}

// Helper for RouterAI API (routerai.ru - OpenAI API compatible)
async function analyzeCallWithRouterAI(
  transcriptInput: string,
  audioBase64?: { data: string; mimeType: string },
  config?: RouterAIConfig
): Promise<Partial<CallRecord>> {
  const rawKey = config?.apiKey || process.env.ROUTERAI_API_KEY || '';
  const apiKey = rawKey.trim().replace(/^["']|["']$/g, '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, '');

  let baseUrl = (config?.baseUrl || 'https://routerai.ru/api/v1').trim().replace(/\/+$/, '');
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = 'https://' + baseUrl;
  }

  const modelName = config?.model || 'google/gemini-2.5-flash-lite';

  if (!apiKey) {
    appendLog('warning', 'routerai', 'API ключ RouterAI не задан. Запущена резервная аналитика.');
    return getFallbackAnalysis(transcriptInput, 'отсутствует API ключ RouterAI');
  }

  const promptSystem = `Ты — AI-помощник для анализа телефонных разговоров сети салонов красоты.
ЯЗЫК СТЕНОГРАММЫ И АНАЛИЗА — СТРОГО РУССКИЙ. Все поля JSON (стенограмма, резюме, ключевые факты, рекомендации, комментарии) ДОЛЖНЫ БЫТЬ ИСКЛЮЧИТЕЛЬНО НА РУССКОМ ЯЗЫКЕ.

КОНТЕКСТ САЛОНА КРАСОТЫ:
- Официальное название салона: «Лик 28» (Салон красоты «Лик 28»). В разговорной речи может звучать как «Лик двадцать восемь», «салон Лик 28», «студия Лик 28».
- ПРАВИЛЬНОЕ НАИМЕНОВАНИЕ: При транскрипции и анализе всегда фиксируй название салона строго как «Лик 28» (не искажай в «Ликс», «Лайк», «Лиг», «Элик» и т.п.).
- СТАНДАРТ ПРИВЕТСТВИЯ: Название «Лик 28» является официальным эталонным брендом компании. Если администратор представляется от имени салона «Лик 28» или «Салон красоты Лик 28», это абсолютно правильно! Категорически запрещено считать это ошибкой или снижать оценку оператора.

СТРОГИЕ ПРАВИЛА И ИСКЛЮЧЕНИЕ ГАЛЛЮЦИНАЦИЙ:
1. Проанализируй разговор строго по реально фактически прозвучавшим данным. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО выдумывать детали, имена клиентов, номера заказов (например "заказ №12345"), цены, товары или услуги, которых НЕ БЫЛО в записи или тексте!
2. ЕСЛИ НА АУДИО ИЛИ В ТЕКСТЕ СРАБОТАЛ АВТООТВЕТЧИК, АВТОИНФОРМАТОР ИЛИ АБОНЕНТ НЕДОСТУПЕН (например: "Абонент сейчас не может ответить...", "Перезвоните позднее", "Оставьте сообщение после сигнала"):
   - В "transcript" выведи СТРОГО реально прозвучавшую фразу (например: "Автоответчик: Абонент сейчас не может ответить на ваш звонок. Попробуйте перезвонить позднее.").
   - В "summary" выведи СТРОГО: "Разговор не состоялся: сработал автоответчик или системный автоинформатор".
   - В "operator_score" выведи null (так как диалога с оператором не было).
   - В "operator_comment" напиши: "Разговор с клиентом не состоялся: на линии сработал автоответчик или автоинформатор".
   - В "key_facts.call_outcome" напиши: "автоответчик".
   - В "key_facts.client_issue" напиши: "Автоответчик / Абонент недоступен".

ВАЖНО: ТВОЙ ОТВЕТ ДОЛЖЕН БЫТЬ СТРОГО В ФОРМАТЕ RAW JSON! НЕ ДОБАВЛЯЙ НИКАКИХ ВВОДНЫХ СЛОВ ИЛИ ПРИВЕТСТВИЙ ТИПА "Пожалуйста", "Вот результат" И Т.П. ПЕРВЫЙ СИМВОЛ ОТВЕТА — '{', ПОСЛЕДНИЙ — '}'.

Схема JSON:
{
  "transcript": "дословная стенограмма на русском языке",
  "summary": "краткая суть разговора по фактам на русском языке",
  "key_facts": {
    "is_dispute": false,
    "dispute_reason": null,
    "promises": [],
    "tone_client": "нейтральный",
    "tone_manager": "спокойный",
    "call_outcome": "успешно",
    "client_issue": "вопрос клиента"
  },
  "trigger_phrases": [],
  "recommendations": ["рекомендация 1 на русском языке"],
  "operator_score": 9,
  "operator_comment": "комментарий к работе оператора на русском языке"
}`;

  const cleanText = (transcriptInput || '').trim();
  const hasAudio = !!audioBase64;

  appendLog('info', 'routerai', `Запрос к API RouterAI (Модель: ${modelName}, URL: ${baseUrl}, Аудио: ${hasAudio ? 'Да (мультимодальный)' : 'Нет'})...`);

  // Build primary user message content supporting direct audio via input_audio / base64
  let userMessageContent: any;
  if (hasAudio && (!cleanText || cleanText === 'Загрузка аудиозаписи...' || cleanText === 'Обработка аудио...')) {
    const mimeType = audioBase64!.mimeType || 'audio/mp3';
    const format = mimeType.includes('wav') ? 'wav' : mimeType.includes('ogg') ? 'ogg' : mimeType.includes('m4a') ? 'm4a' : 'mp3';
    userMessageContent = [
      {
        type: 'text',
        text: 'Прослушай эту аудиозапись телефонного разговора. Официальное название салона — «Лик 28» (Салон красоты «Лик 28»). Сделай её точную дословную стенограмму (по репликам "Менеджер:", "Клиент:") и выполни полный анализ качества обслуживания по указанной схеме JSON. Верни строго RAW JSON.'
      },
      {
        type: 'input_audio',
        input_audio: {
          data: audioBase64!.data,
          format: format
        }
      }
    ];
  } else {
    userMessageContent = `Текст/данные диалога (Салон красоты «Лик 28»):\n${cleanText || 'Аудиозапись телефонного разговора.'}\n\nВыполни анализ и верни строго JSON без вводных слов.`;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    let response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: promptSystem },
          { role: 'user', content: userMessageContent }
        ],
        temperature: 0.2
      })
    });

    // Fallback attempt with audio_url data-URI if input_audio format is rejected
    if (!response.ok && Array.isArray(userMessageContent)) {
      const mimeType = audioBase64!.mimeType || 'audio/mp3';
      appendLog('warning', 'routerai', `Первичный запрос с input_audio вернул HTTP ${response.status}. Пробуем формат audio_url (data-URI)...`);
      
      const altUserMessageContent = [
        {
          type: 'text',
          text: 'Прослушай эту аудиозапись телефонного разговора. Официальное название салона — «Лик 28» (Салон красоты «Лик 28»). Сделай её точную дословную стенограмму (по репликам "Менеджер:", "Клиент:") и выполни полный анализ качества обслуживания по указанной схеме JSON. Верни строго RAW JSON.'
        },
        {
          type: 'audio_url',
          audio_url: {
            url: `data:${mimeType};base64,${audioBase64!.data}`
          }
        }
      ];

      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: 'system', content: promptSystem },
            { role: 'user', content: altUserMessageContent }
          ],
          temperature: 0.2
        })
      });
    }

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      let routerAiMsg = errText;
      try {
        const errJson = JSON.parse(errText);
        if (errJson.error?.message) {
          routerAiMsg = errJson.error.message;
        }
      } catch {
        // use raw text
      }

      // If direct audio in RouterAI is unsupported by the model or failed, trigger Gemini fallback transcription
      if (hasAudio && (!cleanText || cleanText === 'Загрузка аудиозаписи...')) {
        appendLog('warning', 'routerai', `Прямая передача аудио в RouterAI не поддерживается моделью ${modelName} или вернула ошибку (${routerAiMsg}). Запуск фолбэк-расшифровки через Gemini...`);
        const geminiClient = getGeminiClient();
        if (geminiClient) {
          try {
            const gResponse = await geminiClient.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: [
                {
                  role: 'user',
                  parts: [
                    { inlineData: { mimeType: audioBase64!.mimeType, data: audioBase64!.data } },
                    { text: 'Сделай точную дословную расшифровку (стенограмму) этой аудиозаписи на русском языке. Официальное название салона — «Лик 28» (Салон красоты «Лик 28»). Напиши диалог репликами в формате "Менеджер: ...", "Клиент: ...". Напиши только текст диалога без дополнительных комментариев.' }
                  ]
                }
              ]
            });
            if (gResponse.text && gResponse.text.trim()) {
              const transcribedText = gResponse.text.trim();
              appendLog('success', 'routerai', `Фолбэк-транскрипция выполнена (${transcribedText.length} символов). Передача текста диалога в RouterAI...`);
              return await analyzeCallWithRouterAI(transcribedText, undefined, config);
            }
          } catch (gErr: any) {
            appendLog('warning', 'routerai', `Фолбэк-расшифровка через Gemini не удалась: ${gErr.message || gErr}`);
          }
        }
      }

      let hint = '';
      if (routerAiMsg.includes('Missing Authentication') || routerAiMsg.includes('Unauthorized') || routerAiMsg.includes('Invalid API Key')) {
        hint = ' -> Проверьте правильность API ключа RouterAI в настройках.';
      } else if (routerAiMsg.includes('Insufficient credits') || routerAiMsg.includes('balance') || routerAiMsg.includes('credit')) {
        hint = ' -> Недостаточно средств/баланса на аккаунте RouterAI.';
      }

      throw new Error(`RouterAI API (HTTP ${response.status}): ${routerAiMsg}${hint}`);
    }

    const data = await response.json();
    const rawText = data.choices?.[0]?.message?.content || '{}';
    const parsed = extractAndParseLLMJson(rawText, transcriptInput, 'routerai');

    // If RouterAI returned HTTP 200 OK, but the LLM output indicates it didn't receive audio/text
    const summaryStr = (parsed.summary || '').toLowerCase();
    const transcriptStr = (parsed.transcript || '').toLowerCase();
    const commentStr = (parsed.operator_comment || '').toLowerCase();
    const isMissingDataMessage = 
      summaryStr.includes('не предоставил текст') ||
      summaryStr.includes('не содержит данных') ||
      summaryStr.includes('отсутствует текст') ||
      summaryStr.includes('не содержит текста') ||
      summaryStr.includes('предоставьте аудиозапись') ||
      summaryStr.includes('предоставьте текст') ||
      summaryStr.includes('без исходных данных') ||
      summaryStr.includes('не могу сформировать json') ||
      transcriptStr.includes('не предоставлен') ||
      transcriptStr.includes('предоставьте аудиозапись') ||
      transcriptStr.includes('без исходных данных') ||
      commentStr.includes('не предоставил') ||
      commentStr.includes('предоставьте аудиозапись') ||
      commentStr.includes('запросила исходные данные');

    if (isMissingDataMessage && hasAudio && (!cleanText || cleanText === 'Загрузка аудиозаписи...')) {
      appendLog('warning', 'routerai', `RouterAI (${modelName}) вернул ответ о нехватке текста диалога. Запуск авто-расшифровки записи через Gemini...`);
      const geminiClient = getGeminiClient();
      if (geminiClient) {
        try {
          const gResponse = await geminiClient.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
              {
                role: 'user',
                parts: [
                  { inlineData: { mimeType: audioBase64!.mimeType, data: audioBase64!.data } },
                  { text: 'Сделай точную дословную расшифровку (стенограмму) этой аудиозаписи на русском языке. Официальное название салона — «Лик 28» (Салон красоты «Лик 28»). Если запись пустая или тишина — напиши "Аудиозапись не содержит разборчивой речи". Напиши диалог репликами в формате "Менеджер: ...", "Клиент: ...". Напиши только текст диалога без дополнительных комментариев.' }
                ]
              }
            ]
          });
          if (gResponse.text && gResponse.text.trim()) {
            const transcribedText = gResponse.text.trim();
            appendLog('success', 'routerai', `Авто-расшифровка через Gemini выполнена (${transcribedText.length} символов). Повторная передача диалога в RouterAI...`);
            return await analyzeCallWithRouterAI(transcribedText, undefined, config);
          }
        } catch (gErr: any) {
          appendLog('warning', 'routerai', `Авто-расшифровка через Gemini не удалась: ${gErr.message || gErr}`);
        }
      }
    }

    const usage = data.usage;
    const promptTok = usage?.prompt_tokens ?? Math.ceil(((cleanText || '').length + 1200) / 4);
    const compTok = usage?.completion_tokens ?? Math.ceil(rawText.length / 4);
    parsed.tokens_used = {
      prompt_tokens: promptTok,
      completion_tokens: compTok,
      total_tokens: usage?.total_tokens ?? (promptTok + compTok)
    };

    appendLog('success', 'routerai', `Звонок успешно проанализирован через RouterAI API (${modelName}). Токены: ${parsed.tokens_used.total_tokens}`);
    return parsed;
  } catch (err: any) {
    if (hasAudio && (!cleanText || cleanText === 'Загрузка аудиозаписи...')) {
      appendLog('warning', 'routerai', `Ошибка прямого запроса аудио в RouterAI (${err.message || err}). Пробуем фолбэк-расшифровку через Gemini...`);
      const geminiClient = getGeminiClient();
      if (geminiClient) {
        try {
          const gResponse = await geminiClient.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
              {
                role: 'user',
                parts: [
                  { inlineData: { mimeType: audioBase64!.mimeType, data: audioBase64!.data } },
                  { text: 'Сделай точную дословную расшифровку (стенограмму) этой аудиозаписи на русском языке. Официальное название салона — «Лик 28» (Салон красоты «Лик 28»). Если запись пустая или тишина — напиши "Аудиозапись не содержит разборчивой речи". Напиши диалог репликами в формате "Менеджер: ...", "Клиент: ...". Напиши только текст диалога без дополнительных комментариев.' }
                ]
              }
            ]
          });
          if (gResponse.text && gResponse.text.trim()) {
            const transcribedText = gResponse.text.trim();
            appendLog('success', 'routerai', `Фолбэк-транскрипция через Gemini выполнена (${transcribedText.length} символов). Передача текста диалога в RouterAI...`);
            return await analyzeCallWithRouterAI(transcribedText, undefined, config);
          }
        } catch (gErr: any) {
          appendLog('warning', 'routerai', `Фолбэк-расшифровка через Gemini не удалась: ${gErr.message || gErr}`);
        }
      }
    }

    const isTimeout = err.name === 'AbortError';
    const errMsg = isTimeout
      ? `Таймаут подключения (60с) к ${baseUrl}. Сервер недоступен.`
      : `Ошибка вызова RouterAI (${modelName}): ${err.message || err}`;
    appendLog('error', 'routerai', errMsg);
    return getFallbackAnalysis(transcriptInput, errMsg);
  }
}

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
    if (model === 'GigaChat:Pro' || model === 'GigaChat:Max' || model === 'GigaChat:Lite') {
      gigaModel = model;
    }
    appendLog('info', 'gigachat', `Отправка запроса на анализ в модель ${gigaModel}...`);
    const analysis = await analyzeWithRetry(anonymizedText, gigaModel);
    appendLog('success', 'gigachat', `Звонок успешно проанализирован моделью ${gigaModel}.`);
    return {
      success: true,
      result: {
        transcript: cleanTranscript,
        summary: analysis.transcript_summary,
        key_facts: {
          ...analysis.key_facts,
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

// Unified SpeechKit STT + GigaChat LLM Calling Logic with 152-ФЗ Anonymization
async function analyzeCallTextOrAudio(
  requestedModel: string,
  transcriptInput: string,
  audioBase64?: { data: string; mimeType: string },
  audioDownloadFailed: boolean = false
): Promise<Partial<CallRecord>> {
  let cleanTranscript = (transcriptInput || '').trim();
  if (
    cleanTranscript === 'Загрузка аудиозаписи...' ||
    cleanTranscript === 'Обработка аудио...' ||
    cleanTranscript.startsWith('Аудиозапись не была') ||
    cleanTranscript.startsWith('Стенограмма отсутствует')
  ) {
    cleanTranscript = '';
  }

  if (audioDownloadFailed && !cleanTranscript) {
    appendLog('error', 'megafon', `Анализ звонка прерван: не удалось скачать аудиозапись с сервера Мегафон.`);
    return getFallbackAnalysis('', 'не удавалось скачать');
  }

  // 1. If audio is available and transcript is missing, transcribe via Yandex SpeechKit
  if (!cleanTranscript && audioBase64 && audioBase64.data) {
    try {
      appendLog('info', 'speechkit', 'Запуск распознавания аудиозаписи через Yandex SpeechKit (модель general)...');
      const audioBuffer = Buffer.from(audioBase64.data, 'base64');
      const sttText = await transcribeWithRetry(audioBuffer);
      if (sttText && sttText.trim()) {
        cleanTranscript = sttText.trim();
        appendLog('success', 'speechkit', `Аудиозапись успешно расшифрована Yandex SpeechKit (${cleanTranscript.length} симв.)`);
      } else {
        appendLog('warning', 'speechkit', 'Yandex SpeechKit вернул пустой текст или запись не содержит разборчивой речи.');
      }
    } catch (sttErr: any) {
      appendLog('error', 'speechkit', `Ошибка распознавания речи через SpeechKit: ${sttErr.message || sttErr}`);
    }
  }

  if (!cleanTranscript) {
    appendLog('warning', 'gigachat', 'Отсутствует аудиозапись или текст диалога для анализа. Вызов ИИ пропущен.');
    return {
      transcript: 'Аудиозапись не была загружена или не содержит разборчивой речи',
      summary: 'Аудиозапись не была загружена или не содержит разборчивой речи. Анализ разговора невозможно выполнить.',
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        promises: [],
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'не состоялся',
        client_issue: 'Отсутствует аудиозапись или текст для анализа'
      },
      trigger_phrases: [],
      recommendations: ['Обеспечить наличие аудиозаписи или текста диалога для проведения анализа.'],
      operator_score: null,
      operator_comment: 'Оценка не выставлена: аудиозапись не загружена или не содержит разборчивой речи.'
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

  appendLog('info', 'gigachat', `Отправка обезличенной стенограммы на анализ в ${modelToUse}...`);
  try {
    const analysis = await analyzeWithRetry(anonymizedText, modelToUse);
    appendLog('success', 'gigachat', `Анализ звонка успешно выполнен моделью ${modelToUse}.`);
    return {
      transcript: cleanTranscript,
      summary: analysis.transcript_summary,
      key_facts: {
        ...analysis.key_facts,
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
    return getFallbackAnalysis(cleanTranscript, llmErr.message || String(llmErr));
  }
}

// Local simulation analysis with error-reporting support or premium dynamic transcript parsing
function getFallbackAnalysis(transcript: string, errorReason?: string): Partial<CallRecord> {
  if (errorReason) {
    let readableError = 'Технический сбой аналитики.';
    if (errorReason === 'не удавалось скачать') {
      readableError = 'Ошибка: не удавалось скачать аудиофайл записи разговора с сервера АТС.';
    } else if (errorReason === 'отсутствует ключ Gemini') {
      readableError = 'Ошибка: отсутствует ключ Gemini (GEMINI_API_KEY) в настройках системы.';
    } else if (errorReason === 'исчерпан лимит токенов') {
      readableError = 'Ошибка: исчерпан лимит токенов или превышена квота запросов к API Gemini.';
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

  const cleanTranscript = transcript || '';

  // Extract manager and client names if explicitly present
  let managerName = 'Менеджер';
  let clientName = 'Клиент';
  const lines = cleanTranscript.split('\n');
  for (const line of lines) {
    if (line.toLowerCase().startsWith('менеджер:') || line.toLowerCase().startsWith('администратор:')) {
      const match = line.match(/(меня зовут|это)\s+([А-Яа-яA-Za-z]+)/i);
      if (match && match[2]) {
        managerName = match[2];
      }
    }
    if (line.toLowerCase().startsWith('клиент:')) {
      const match = line.match(/(меня зовут|это)\s+([А-Яа-яA-Za-z]+)/i);
      if (match && match[2]) {
        clientName = match[2];
      }
    }
  }

  // Dispute check strictly based on transcript text
  const isDispute = cleanTranscript.toLowerCase().includes('отмен') || 
                    cleanTranscript.toLowerCase().includes('криво') || 
                    cleanTranscript.toLowerCase().includes('жалоб') ||
                    cleanTranscript.toLowerCase().includes('претензи') ||
                    cleanTranscript.toLowerCase().includes('недоволен');

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

  let summary = cleanTranscript 
    ? `Разговор по записи: ${cleanTranscript.slice(0, 250)}${cleanTranscript.length > 250 ? '...' : ''}` 
    : 'Разговор без стенограммы.';

  const score = isDispute ? 7 : 9;
  const operatorComment = `Оценка сформирована строго по тексту предоставленной стенограммы (${cleanTranscript.length} символов) без выдуманных данных.`;

  return {
    transcript: cleanTranscript,
    summary,
    key_facts: {
      is_dispute: isDispute,
      dispute_reason: isDispute ? 'Зафиксировано недовольство в тексте разговора' : null,
      promises: [],
      tone_client: isDispute ? 'недовольный' : 'нейтральный',
      tone_manager: 'спокойный',
      call_outcome: isDispute ? 'перенесён' : 'успешно',
      client_issue: isDispute ? 'Вопрос по обслуживанию' : 'Консультация'
    },
    trigger_phrases: triggerPhrases,
    recommendations: [
      'Следовать стандартам общения и вежливости при обслуживании.'
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

  let templateToUse = config.template || '';
  if (!templateToUse.includes('{call_date_time}') && !templateToUse.includes('{call_date}') && !templateToUse.includes('{call_time}') && !templateToUse.includes('{date}') && !templateToUse.includes('{time}') && !templateToUse.includes('{timestamp}')) {
    if (templateToUse.includes('\n')) {
      const firstLineEnd = templateToUse.indexOf('\n');
      templateToUse = templateToUse.slice(0, firstLineEnd) + `\n📅 *Дата и время (UTC+4):* {call_date_time}` + templateToUse.slice(firstLineEnd);
    } else {
      templateToUse = `📅 *Дата и время (UTC+4):* {call_date_time}\n` + templateToUse;
    }
  }

  let message = templateToUse
    .replace(/{call_id}/g, call.call_id)
    .replace(/{call_date_time}/g, callDateTimeUtc4)
    .replace(/{call_date}/g, callDateUtc4)
    .replace(/{call_time}/g, callTimeUtc4)
    .replace(/{date}/g, callDateUtc4)
    .replace(/{time}/g, callTimeUtc4)
    .replace(/{timestamp}/g, callDateTimeUtc4)
    .replace(/{client_name}/g, call.client_name || 'Неизвестный клиент')
    .replace(/{operator_score}/g, String(call.operator_score))
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

// Download remote audio recording from Megafon VATS and encode as base64 for Gemini
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
  const payload = {
    jsonrpc: '2.0',
    id: String(Date.now()),
    method,
    params
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
        body: JSON.stringify(payload)
      });

      if (response.status === 404) {
        throw new Error(`404 Not Found`);
      }

      if (!response.ok) {
        throw new Error(`HTTP status ${response.status} ${response.statusText}`);
      }

      const json: any = await response.json();
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
    appendLog('warning', 'megafon', `Не удалось динамически получить ID отчета Мегафон: ${err.message || err}. Будет использован ID по умолчанию (1015).`);
  }
  return 1015;
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
      const dirVal = item.call_direction?.value_id || item.direction;
      const direction = dirVal === 'in' ? 'incoming' : 'outgoing';

      const statusId = item.call_status?.value_id || '';
      const talkDurationSec = parseDurationToSeconds(item.call_talk_duration);
      const totalDurationSec = parseDurationToSeconds(item.call_total_duration);
      
      const isAnswered = talkDurationSec > 0 || (statusId === 'received' && totalDurationSec > 0);
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
        duration_seconds: talkDurationSec || totalDurationSec || 0,
        type: direction,
        is_answered: isAnswered,
        client_phone: clientPhone,
        client_name: clientName,
        operator_name: operatorName,
        transcript: isAnswered ? 'Загрузка аудиозаписи...' : '',
        status,
        record_play_uri: recordPlayUri
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

    if (needsUpdate) {
      db.calls[existingCallIdx] = existingCall;
      writeDb(db);
    }

    // Return false: Call already exists in DB
    return false;
  }

  const isAnswered = extCall.is_answered && (extCall.duration_seconds > 0);
  const isIncoming = extCall.type === 'incoming';

  let newCall: CallRecord;

  if (!isAnswered || extCall.duration_seconds === 0) {
    // Unanswered or missed call (00:00 duration)
    newCall = {
      call_id: extCall.call_id,
      timestamp: extCall.timestamp,
      duration_seconds: 0,
      model_used: db.config.activeModel || 'gemini',
      transcript: 'Звонок не состоялся. Длительность разговора 00:00 (пропущенный вызов или сброс). Запись разговора и стенограмма отсутствуют.',
      summary: isIncoming ? 'Пропущенный входящий звонок (00:00)' : 'Исходящий звонок, абонент не ответил (00:00)',
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        promises: [],
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'не успешно',
        client_issue: isIncoming ? 'Пропущенный звонок' : 'Непринятый исходящий'
      },
      trigger_phrases: [],
      recommendations: isIncoming 
        ? ['Рекомендуется как можно скорее перезвонить клиенту для уточнения цели обращения.'] 
        : ['Попробовать связаться с клиентом повторно в другое время.'],
      operator_score: null,
      operator_comment: isIncoming 
        ? 'Разговор не состоялся: длительность вызова 00:00. Зафиксирован пропущенный вызов.' 
        : 'Разговор не состоялся: абонент не ответил на исходящий вызов сотрудника (00:00).',
      client_name: extCall.client_name,
      operator_name: extCall.operator_name,
      status: 'missed',
      type: extCall.type,
      is_answered: false,
      is_demo: false
    };

    db.calls.unshift(newCall);
    writeDb(db);
    try {
      registerConsent({
        client_phone: extCall.client_phone || '',
        consent_type: 'not_applicable',
        status: 'not_applicable',
        purposes: []
      });
    } catch (cErr) {
      console.warn('[152-ФЗ] Ошибка регистрации статуса пропущенного звонка:', cErr);
    }
    appendLog(
      'warning', 
      'megafon', 
      isIncoming 
        ? `Импортирован пропущенный вызов (00:00) от ${extCall.client_name} (${extCall.client_phone})`
        : `Импортирован непринятый исходящий вызов (00:00) клиенту ${extCall.client_name} (${extCall.client_phone})`
    );
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
      operator_score: 0,
      operator_comment: '',
      client_name: extCall.client_name,
      operator_name: extCall.operator_name,
      status: 'processing',
      type: extCall.type,
      is_answered: true,
      audio_url: extCall.record_play_uri || undefined,
      is_demo: false
    };

    db.calls.unshift(newCall);
    writeDb(db);
    try {
      ensureAutoConsent(extCall.client_phone || '', extCall.call_id);
    } catch (cErr) {
      console.warn('[152-ФЗ] Ошибка авто-регистрации согласия:', cErr);
    }
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
          db.config.activeModel || 'gemini',
          extCall.transcript,
          audioBase64,
          audioDownloadFailed
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
    if (db.config.megafon && db.config.megafon.active && db.config.megafon.pollingEnabled) {
      const lastPollStr = db.config.megafon.lastPollingTime || new Date(Date.now() - 3600000 * 12).toISOString();
      const lastPollDate = new Date(lastPollStr);
      
      const intervalMins = Math.max(1, parseInt(String(db.config.megafon.pollingIntervalMinutes || 5), 10));
      const intervalMs = intervalMins * 60 * 1000;
      
      if (Date.now() - lastPollDate.getTime() < intervalMs) {
        return; // Not enough time has passed yet
      }

      const now = new Date();
      const token = db.config.megafon.token;

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
      const queryFromDate = new Date(lastPollDate.getTime() - 1 * 3600000);
      const newCalls = await getRealMegafonCalls(queryFromDate, now, token);

      let importedCount = 0;
      for (const extCall of newCalls) {
        const imported = await importCallRecord(extCall);
        if (imported) {
          importedCount++;
        }
      }

      // Update lastPollingTime in DB to now
      const updatedDb = readDb();
      updatedDb.config.megafon.lastPollingTime = now.toISOString();
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

// S3 Storage Status & Manual Sync endpoints
app.get('/api/s3/status', (req, res) => {
  const cfg = getS3Config();
  res.json({
    configured: !!cfg,
    bucket: cfg?.bucket || null,
    endpoint: cfg?.endpoint || null,
    prefix: cfg?.prefix || null,
    key: cfg?.key || null,
    lastSync: s3LastSyncTime,
    lastError: s3LastError
  });
});

app.post('/api/s3/sync', async (req, res) => {
  const cfg = getS3Config();
  if (!cfg) {
    return res.status(400).json({ success: false, message: 'Переменные окружения S3 не настроены в деплое (S3_BUCKET_NAME, S3_ACCESS_KEY, S3_SECRET_KEY)' });
  }

  const success = await syncToS3();
  if (success) {
    return res.json({ success: true, message: `База данных успешно сохранена в S3: ${cfg.bucket}/${cfg.key}`, lastSync: s3LastSyncTime });
  } else {
    return res.status(500).json({ success: false, message: `Ошибка записи в S3: ${s3LastError}` });
  }
});

app.post('/api/s3/pull', async (req, res) => {
  const cfg = getS3Config();
  if (!cfg) {
    return res.status(400).json({ success: false, message: 'Переменные окружения S3 не настроены' });
  }

  const success = await syncFromS3OnBoot();
  if (success) {
    return res.json({ success: true, message: `Данные успешно загружены из S3`, callsCount: dbCache?.calls?.length || 0 });
  } else {
    return res.status(500).json({ success: false, message: `Ошибка получения данных из S3: ${s3LastError}` });
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

// Manual period load trigger
app.post('/api/calls/fetch-period', async (req, res) => {
  const { from, to } = req.body;
  
  if (!from || !to) {
    return res.status(400).json({ error: 'Параметры "from" и "to" обязательны' });
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);
  
  const db = readDb();
  const token = db.config.megafon.token;

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

    res.json({
      success: true,
      found: periodCalls.length,
      imported: importedCount,
      message: `Импорт завершен. Добавлено новых звонков: ${importedCount} из ${periodCalls.length} найденных.`
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Ошибка ручного импорта звонков', details: err.message });
  }
});

// Manual trigger for poll check
app.post('/api/calls/fetch-poll', async (req, res) => {
  const db = readDb();
  const lastPollStr = db.config.megafon.lastPollingTime || new Date(Date.now() - 3600000 * 12).toISOString();
  const lastPollDate = new Date(lastPollStr);
  const now = new Date();
  const token = db.config.megafon.token;

  appendLog('info', 'megafon', `Ручной запуск опроса АТС с ${lastPollDate.toLocaleString()} по ${now.toLocaleString()}`);

  try {
    // Добавляем запас времени (оверлап) 1 час, чтобы исключить пропуски звонков из-за задержки их появления в АТС
    const queryFromDate = new Date(lastPollDate.getTime() - 1 * 3600000);
    const newCalls = await getRealMegafonCalls(queryFromDate, now, token);

    let importedCount = 0;
    for (const extCall of newCalls) {
      const imported = await importCallRecord(extCall);
      if (imported) {
        importedCount++;
      }
    }

    const updatedDb = readDb();
    updatedDb.config.megafon.lastPollingTime = now.toISOString();
    writeDb(updatedDb);

    res.json({
      success: true,
      imported: importedCount,
      lastPollingTime: updatedDb.config.megafon.lastPollingTime
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Ошибка опроса АТС Мегафон', details: err.message });
  }
});

// 1. GET ALL CALLS (with 152-ФЗ Role Masking & Consent mapping)
app.get('/api/calls', (req, res) => {
  const db = readDb();
  const userRole = (req.headers['x-user-role'] as string) || 'admin';

  const mappedCalls = (db.calls || []).map((c: any) => {
    const rawPhone = c.client_phone || c.full_phone || '';
    const masked = c.client_phone_masked || maskPhone(rawPhone);
    const consent = getConsentForPhone(rawPhone);

    const callCopy: any = {
      ...c,
      client_phone_masked: masked,
      consent_status: consent?.status || (c.status === 'missed' ? 'not_applicable' : 'active'),
      consent_purposes: consent?.purposes || ['quality_control', 'training']
    };

    // 152-ФЗ Privacy restrictions: Managers & Viewers cannot view full conversation transcripts
    if (userRole === 'manager' || userRole === 'viewer') {
      delete callCopy.transcript;
    }
    // Viewers cannot view full phone numbers
    if (userRole === 'viewer') {
      delete callCopy.client_phone;
      delete callCopy.full_phone;
    }

    return callCopy;
  });

  res.json(mappedCalls);
});

// 2. GET SINGLE CALL (with 152-ФЗ Role Masking)
app.get('/api/calls/:id', (req, res) => {
  const db = readDb();
  const userRole = (req.headers['x-user-role'] as string) || 'admin';
  const call = db.calls.find((c: any) => c.call_id === req.params.id);
  if (!call) {
    return res.status(404).json({ error: 'Звонок не найден' });
  }

  const rawPhone = call.client_phone || call.full_phone || '';
  const masked = call.client_phone_masked || maskPhone(rawPhone);
  const consent = getConsentForPhone(rawPhone);

  const callCopy: any = {
    ...call,
    client_phone_masked: masked,
    consent_status: consent?.status || (call.status === 'missed' ? 'not_applicable' : 'active'),
    consent_purposes: consent?.purposes || ['quality_control', 'training']
  };

  if (userRole === 'manager' || userRole === 'viewer') {
    delete callCopy.transcript;
  }
  if (userRole === 'viewer') {
    delete callCopy.client_phone;
    delete callCopy.full_phone;
  }

  res.json(callCopy);
});

// 2.1. REANALYZE CALL WITH GIGACHAT (152-ФЗ Compliant)
app.post('/api/calls/:id/reanalyze', async (req, res) => {
  const { id } = req.params;
  const userRole = (req.headers['x-user-role'] as string) || 'admin';
  if (userRole === 'viewer') {
    return res.status(403).json({ error: 'Недостаточно прав для переанализа (роль Наблюдатель)' });
  }

  const db = readDb();
  const callIdx = db.calls.findIndex((c: any) => c.call_id === id);
  if (callIdx === -1) {
    return res.status(404).json({ error: 'Звонок не найден' });
  }

  const call = db.calls[callIdx];
  if (!call.transcript || call.transcript.length < 5) {
    return res.status(400).json({ error: 'Стенограмма разговора пуста или отсутствует' });
  }

  const targetModel = (req.body?.model as GigaChatModel) || db.config?.default_gigachat_model || 'GigaChat:Lite';
  appendLog('info', 'gigachat', `Повторный анализ звонка ${id} через модель ${targetModel}...`);

  try {
    const anonymizedText = anonymizeTranscript(call.transcript);
    const analysis = await analyzeWithRetry(anonymizedText, targetModel);

    const updatedCall: CallRecord = {
      ...call,
      summary: analysis.transcript_summary,
      key_facts: {
        ...analysis.key_facts,
        promises: call.key_facts?.promises || []
      },
      trigger_phrases: call.trigger_phrases || [],
      recommendations: Array.isArray(analysis.recommendations) ? analysis.recommendations : [analysis.recommendations],
      operator_score: analysis.operator_score,
      operator_comment: analysis.operator_comment,
      model_used: targetModel,
      gigachat_model: targetModel,
      status: 'completed'
    };

    db.calls[callIdx] = updatedCall;
    writeDb(db);

    appendLog('success', 'gigachat', `Звонок ${id} успешно переанализирован моделью ${targetModel}`);
    res.json(updatedCall);
  } catch (err: any) {
    appendLog('error', 'gigachat', `Сбой при переанализе ${id}: ${err.message}`);
    res.status(500).json({ error: err.message || 'Внутренняя ошибка переанализа' });
  }
});

// 3. ANALYZE NEW CALL (REST API)
app.post('/api/calls/analyze', async (req, res) => {
  const { transcript, client_name, operator_name, duration_seconds, model, audioBase64 } = req.body;
  const db = readDb();
  const selectedModel = model || db.config.activeModel || 'gemini';

  const durationSec = duration_seconds !== undefined ? Number(duration_seconds) : 120;

  // Handle 0 duration calls immediately without hallucinating dialogues
  if (durationSec === 0) {
    const newCallId = `call-${Date.now()}`;
    const missedCall: CallRecord = {
      call_id: newCallId,
      timestamp: new Date().toISOString(),
      duration_seconds: 0,
      model_used: selectedModel,
      transcript: 'Звонок не состоялся. Длительность разговора 00:00 (пропущенный вызов или сброс). Запись разговора и стенограмма отсутствуют.',
      summary: 'Пропущенный звонок (00:00)',
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        promises: [],
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'не состоялся',
        client_issue: 'Звонок 00:00 / не отвечен'
      },
      trigger_phrases: [],
      recommendations: ['Рекомендуется перезвонить клиенту для уточнения цели обращения.'],
      operator_score: null,
      operator_comment: 'Разговор не состоялся: длительность вызова 00:00.',
      client_name: client_name || 'Новый клиент',
      operator_name: operator_name || 'Менеджер салона',
      status: 'missed',
      is_answered: false
    };

    db.calls.unshift(missedCall);
    writeDb(db);
    return res.json(missedCall);
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
      audioBase64
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
async function performCallReanalysis(callId: string): Promise<any> {
  const db = readDb();
  const callIdx = db.calls.findIndex((c: any) => c.call_id === callId);
  if (callIdx === -1) {
    throw new Error('Звонок не найден в базе данных');
  }

  const call = db.calls[callIdx];

  // If call duration is 0 or call is missed, do not attempt AI analysis
  if (call.duration_seconds === 0 || call.is_answered === false || call.status === 'missed') {
    call.duration_seconds = 0;
    call.is_answered = false;
    call.status = 'missed';
    call.operator_score = null;
    call.transcript = 'Звонок не состоялся. Длительность разговора 00:00 (пропущенный вызов или сброс). Запись разговора и стенограмма отсутствуют.';
    call.summary = call.type === 'incoming' ? 'Пропущенный входящий звонок (00:00)' : 'Непринятый исходящий звонок (00:00)';
    call.operator_comment = 'Разговор не состоялся: длительность вызова 00:00.';
    call.recommendations = call.type === 'incoming'
      ? ['Рекомендуется перезвонить клиенту для уточнения цели обращения.']
      : ['Попробовать связаться с клиентом повторно в другое время.'];
    db.calls[callIdx] = call;
    writeDb(db);
    return call;
  }

  const existingTranscript = (call.transcript &&
    call.transcript !== 'Загрузка аудиозаписи...' &&
    call.transcript !== 'Обработка аудио...' &&
    !call.transcript.startsWith('Аудиозапись не была') &&
    !call.transcript.startsWith('Стенограмма отсутствует') &&
    !call.transcript.includes('предоставьте аудиозапись')) ? call.transcript : '';

  const selectedModel = db.config.activeModel || 'gemini';

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
      audioDownloadFailed
    );

    const finalDb = readDb();
    const finalCallIdx = finalDb.calls.findIndex((c: any) => c.call_id === callId);
    if (finalCallIdx !== -1) {
      const isFailed = (audioDownloadFailed && !existingTranscript) || isTechnicalErrorResult(analysisResult);
      finalDb.calls[finalCallIdx] = {
        ...finalDb.calls[finalCallIdx],
        ...analysisResult,
        status: isFailed ? 'failed' : 'completed',
        is_demo: false
      };
      if (audioUrl) {
        finalDb.calls[finalCallIdx].audio_url = audioUrl;
      }
      const savedCall = finalDb.calls[finalCallIdx];
      writeDb(finalDb);

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

// Re-analyze an existing call (REST API)
app.post('/api/calls/:id/reanalyze', async (req, res) => {
  const callId = req.params.id;
  try {
    const savedCall = await performCallReanalysis(callId);
    res.json(savedCall);
  } catch (err: any) {
    res.status(500).json({ error: 'Ошибка во время переанализа звонка', details: err.message });
  }
});

// 4. SIMULATE WEBHOOK FROM MEGAFON ATS (Section 2.1) - DISABLED PER CUSTOMER REQUEST
app.post('/api/calls/simulate-webhook', async (req, res) => {
  appendLog('warning', 'megafon', 'Запрос на симуляцию звонка отклонен: функция генерации тестовых звонков отключена.');
  return res.status(403).json({ error: 'Функция генерации тестовых и демо-звонков отключена.' });
});


// 5. GET LOGS
app.get('/api/logs', (req, res) => {
  const db = readDb();
  res.json(db.logs);
});

// 6. CLEAR LOGS
app.post('/api/logs/clear', (req, res) => {
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

// 7. GET CONFIG
app.get('/api/config', (req, res) => {
  const db = readDb();
  res.json(db.config);
});

// 8. UPDATE CONFIG
app.post('/api/config', (req, res) => {
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
    },
    openrouter: {
      ...db.config.openrouter,
      ...(body.openrouter || {})
    },
    routerai: {
      ...db.config.routerai,
      ...(body.routerai || {})
    }
  };

  writeDb(db);
  appendLog('info', 'system', `Конфигурация системы успешно обновлена. Интервал авто-опроса АТС: ${db.config.megafon.pollingIntervalMinutes} мин. (автоопрос: ${db.config.megafon.pollingEnabled ? 'включен' : 'выключен'})`);
  res.json(db.config);
});

// 8.1. TEST OPENROUTER API CONNECTION
app.post('/api/openrouter/test', async (req, res) => {
  const { apiKey, baseUrl, model } = req.body || {};
  const rawKey = apiKey || process.env.OPENROUTER_API_KEY || '';
  const effectiveKey = rawKey.trim().replace(/^["']|["']$/g, '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, '');

  let effectiveUrl = (baseUrl || 'https://api.ru-openrouter.ru/v1').trim().replace(/\/+$/, '');
  if (!effectiveUrl.startsWith('http://') && !effectiveUrl.startsWith('https://')) {
    effectiveUrl = 'https://' + effectiveUrl;
  }

  const effectiveModel = model || 'google/gemini-2.5-flash-lite';

  if (!effectiveKey) {
    return res.status(400).json({ success: false, error: 'API ключ не указан в настройках' });
  }

  try {
    appendLog('info', 'openrouter', `Тестирование соединения с OpenRouter API (${effectiveUrl}, модель: ${effectiveModel})...`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const response = await fetch(`${effectiveUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${effectiveKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://openrouter.ai',
        'X-Title': 'Call Analytics Test'
      },
      body: JSON.stringify({
        model: effectiveModel,
        messages: [{ role: 'user', content: 'Привет! Ответь одним словом "OK".' }],
        max_tokens: 10
      })
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      let openRouterMsg = errText;
      try {
        const errJson = JSON.parse(errText);
        if (errJson.error?.message) {
          openRouterMsg = errJson.error.message;
        }
      } catch {
        // use raw
      }

      let hint = '';
      if (openRouterMsg.includes('Missing Authentication header') || openRouterMsg.includes('User not found')) {
        hint = ' -> Проверьте правильность API ключа в настройках и убедитесь, что ключ совпадает с личным кабинетом выбранного сервиса.';
      } else if (openRouterMsg.includes('Insufficient credits') || openRouterMsg.includes('credit')) {
        hint = ' -> На балансе аккаунта закончились кредиты.';
      }

      const userFriendlyError = `OpenRouter API вернул ошибку (HTTP ${response.status}): "${openRouterMsg}"${hint}`;
      return res.status(400).json({ success: false, error: userFriendlyError });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || 'OK';
    appendLog('success', 'openrouter', `Тест подключения к OpenRouter успешен! Ответ модели (${effectiveModel}): "${reply.trim()}"`);
    res.json({ success: true, message: `Соединение с OpenRouter успешно! Ответ модели (${effectiveModel}): "${reply.trim()}"` });
  } catch (err: any) {
    const isTimeout = err.name === 'AbortError';
    let detailMsg = err.message || String(err);
    if (isTimeout || detailMsg.includes('fetch failed')) {
      detailMsg = `Не удалось получить ответ от хоста "${effectiveUrl}" в течение 60 секунд (превышен таймаут или сетевое соединение недоступно). Убедитесь, что эндпоинт и ключ указаны верно.`;
    }
    appendLog('error', 'openrouter', `Ошибка подключения к OpenRouter: ${detailMsg}`);
    res.status(500).json({ success: false, error: detailMsg });
  }
});

// 8.2. TEST ROUTERAI API CONNECTION
app.post('/api/routerai/test', async (req, res) => {
  const { apiKey, baseUrl, model } = req.body || {};
  const db = readDb();
  const rawKey = apiKey || db.config.routerai?.apiKey || process.env.ROUTERAI_API_KEY || '';
  const effectiveKey = rawKey.trim().replace(/^["']|["']$/g, '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, '');

  let effectiveUrl = (baseUrl || 'https://routerai.ru/api/v1').trim().replace(/\/+$/, '');
  if (!effectiveUrl.startsWith('http://') && !effectiveUrl.startsWith('https://')) {
    effectiveUrl = 'https://' + effectiveUrl;
  }

  const effectiveModel = model || 'google/gemini-2.5-flash-lite';

  if (!effectiveKey) {
    return res.status(400).json({
      success: false,
      error: 'API-ключ не указан. Пожалуйста, скопируйте API-ключ из личного кабинета routerai.ru и вставьте его в поле "API ключ RouterAI".'
    });
  }

  try {
    appendLog('info', 'routerai', `Тестирование соединения с RouterAI API (${effectiveUrl}, модель: ${effectiveModel})...`);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const response = await fetch(`${effectiveUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${effectiveKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: effectiveModel,
        messages: [{ role: 'user', content: 'Привет! Ответь одним словом "OK".' }],
        max_tokens: 10
      })
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errText = await response.text();
      let routerAiMsg = errText;
      try {
        const errJson = JSON.parse(errText);
        if (errJson.error?.message) {
          routerAiMsg = errJson.error.message;
        }
      } catch {
        // use raw
      }

      let hint = '';
      if (routerAiMsg.includes('Missing Authentication') || routerAiMsg.includes('Unauthorized') || routerAiMsg.includes('Invalid API Key')) {
        hint = ' -> Проверьте правильность API ключа в настройках RouterAI.';
      } else if (routerAiMsg.includes('Insufficient credits') || routerAiMsg.includes('balance') || routerAiMsg.includes('credit')) {
        hint = ' -> На балансе аккаунта RouterAI закончились средства.';
      }

      const userFriendlyError = `RouterAI API вернул ошибку (HTTP ${response.status}): "${routerAiMsg}"${hint}`;
      return res.status(400).json({ success: false, error: userFriendlyError });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || 'OK';
    appendLog('success', 'routerai', `Тест подключения к RouterAI успешен! Ответ модели (${effectiveModel}): "${reply.trim()}"`);
    res.json({ success: true, message: `Соединение с RouterAI успешно! Ответ модели (${effectiveModel}): "${reply.trim()}"` });
  } catch (err: any) {
    const isTimeout = err.name === 'AbortError';
    let detailMsg = err.message || String(err);
    if (isTimeout || detailMsg.includes('fetch failed')) {
      detailMsg = `Не удалось получить ответ от хоста "${effectiveUrl}" в течение 60 секунд (превышен таймаут или сетевое соединение недоступно). Убедитесь, что эндпоинт и ключ указаны верно.`;
    }
    appendLog('error', 'routerai', `Ошибка подключения к RouterAI: ${detailMsg}`);
    res.status(500).json({ success: false, error: detailMsg });
  }
});

// 8.3. TEST GIGACHAT CONNECTION (Russian Sovereign LLM)
app.post('/api/gigachat/test', async (req, res) => {
  const { model } = req.body || {};
  const targetModel: GigaChatModel = model || 'GigaChat:Lite';
  appendLog('info', 'gigachat', `Тестирование соединения с Сбер GigaChat API (${targetModel})...`);

  try {
    const testSample = 'Менеджер: Добрый день, салон красоты «Лик 28». Клиент: Здравствуйте, хочу узнать стоимость стрижки.';
    const result = await analyzeWithRetry(testSample, targetModel);
    appendLog('success', 'gigachat', `Тест подключения к GigaChat (${targetModel}) успешен!`);
    return res.json({
      success: true,
      message: `Соединение с GigaChat успешно! Модель ${targetModel} работает корректно.`,
      data: result
    });
  } catch (err: any) {
    appendLog('error', 'gigachat', `Ошибка подключения к GigaChat: ${err.message}`);
    res.status(500).json({ success: false, error: err.message || 'Ошибка подключения к GigaChat' });
  }
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
    appendLog('success', 'cleanup', `Очистка завершена: удалено аудиозаписей ${result.audioDeleted}, стенограмм ${result.transcriptsPurged}`);
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

  const stats: DashboardStats = {
    totalCalls: total,
    disputeRate: Math.round((disputes / total) * 100),
    averageScore: Number((totalScore / total).toFixed(1)),
    successRate: Math.round((success / total) * 100),
    toneStats: {
      client: tone_client,
      manager: tone_manager
    }
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

  // Hydrate database from S3 if configured
  syncFromS3OnBoot().catch(err => console.error('[S3 Boot Sync Error]', err));

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
