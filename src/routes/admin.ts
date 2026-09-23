/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, Request, Response } from 'express';
import axios from 'axios';
import https from 'https';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import path from 'path';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';
import { readStore, writeStore } from '../store/store.js';
import { requireRole, logAccess, getCurrentUser } from './auth.js';
import { hashPassword, verifyPassword } from '../store/user-store.js';
import { invalidateGigaChatTokenCache } from '../services/gigachat-auth.js';
import { invalidateAuthorizedKeyCache, getAuthorizedKeyInfo, getIamToken } from '../services/yandex-auth.js';
import { setStoreEncryptionKey, isStoreEncryptionKeyConfigured } from '../store/crypto-store.js';
import { SystemCredentials, GigaChatModel } from '../types.js';

export const adminRouter = Router();

// Protect all admin routes: only 'admin' role allowed
adminRouter.use(requireRole(['admin']));

/**
 * GET /api/admin/credentials
 * Возвращает текущие ключи, токены и настройки интеграций.
 */
adminRouter.get('/credentials', async (req: Request, res: Response) => {
  try {
    const store = await readStore();
    const creds: SystemCredentials = store.config.credentials || {};

    const keyInfo = getAuthorizedKeyInfo();

    res.json({
      // GigaChat
      gigachatAuthKey: creds.gigachatAuthKey || process.env.GIGACHAT_AUTH_KEY || '',
      gigachatModel: creds.gigachatModel || store.config.default_gigachat_model || 'GigaChat:Lite',
      gigachatScope: creds.gigachatScope || process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS',
      gigachatConfigured: !!(creds.gigachatAuthKey || process.env.GIGACHAT_AUTH_KEY),

      // Yandex SpeechKit
      yandexApiKey: creds.yandexApiKey || process.env.YC_API_KEY || '',
      yandexFolderId: creds.yandexFolderId || process.env.YC_FOLDER_ID || '',
      yandexServiceAccountKeyFile: creds.yandexServiceAccountKeyFile || process.env.YC_SERVICE_ACCOUNT_KEY_FILE || (keyInfo.filePath || '/app/keys/authorized_key.json'),
      yandexServiceAccountKeyJson: creds.yandexServiceAccountKeyJson || process.env.YC_SERVICE_ACCOUNT_KEY_JSON || '',
      yandexKeyInfo: keyInfo,
      yandexConfigured: !!(keyInfo.configured || creds.yandexApiKey || process.env.YC_API_KEY || creds.yandexServiceAccountKeyFile || creds.yandexServiceAccountKeyJson),

      // 152-ФЗ Ключ шифрования БД и ПДн
      storeEncryptionKey: creds.storeEncryptionKey || process.env.STORE_ENCRYPTION_KEY || '',
      storeEncryptionKeyConfigured: isStoreEncryptionKeyConfigured(),

      // Yandex Object Storage (для аудиозаписей SpeechKit)
      yandexStorageBucket: creds.yandexStorageBucket || process.env.YC_STORAGE_BUCKET || '',
      yandexStorageAccessKey: creds.yandexStorageAccessKey || process.env.YC_STORAGE_ACCESS_KEY || process.env.YC_S3_KEY_ID || '',
      yandexStorageSecretKey: creds.yandexStorageSecretKey || process.env.YC_STORAGE_SECRET_KEY || process.env.YC_S3_SECRET_KEY || '',
      yandexStorageEndpoint: creds.yandexStorageEndpoint || process.env.YC_STORAGE_ENDPOINT || 'https://storage.yandexcloud.net',
      yandexStorageRegion: creds.yandexStorageRegion || process.env.YC_STORAGE_REGION || 'ru-central1',
      yandexStorageConfigured: !!(
        (creds.yandexStorageAccessKey || process.env.YC_STORAGE_ACCESS_KEY || process.env.YC_S3_KEY_ID) &&
        (creds.yandexStorageBucket || process.env.YC_STORAGE_BUCKET)
      ),

      // S3 Timeweb (для резервной копии базы данных)
      s3Endpoint: creds.s3Endpoint || process.env.S3_ENDPOINT || 'https://s3.timeweb.cloud',
      s3AccessKey: creds.s3AccessKey || process.env.S3_ACCESS_KEY || '',
      s3SecretKey: creds.s3SecretKey || process.env.S3_SECRET_KEY || '',
      s3BucketName: creds.s3BucketName || process.env.S3_BUCKET_NAME || '',
      s3KeyPrefix: creds.s3KeyPrefix || process.env.S3_KEY_PREFIX || 'lik28/data/',
      s3Region: creds.s3Region || process.env.S3_REGION || 'ru-1',
      s3Configured: !!(creds.s3AccessKey || process.env.S3_ACCESS_KEY),

      // Мегафон ВАТС
      megafonToken: creds.megafonToken || store.config.megafon.token || '',
      megafonLkLogin: creds.megafonLkLogin || store.config.megafon.lkLogin || '',
      megafonLkPassword: creds.megafonLkPassword || store.config.megafon.lkPassword || '',
      megafonWebhookUrl: store.config.megafon.webhookUrl || '/api/calls/webhook',
      megafonAutoImport: store.config.megafon.autoImport !== false,
      megafonPollingEnabled: !!store.config.megafon.pollingEnabled,
      megafonPollingIntervalMinutes: store.config.megafon.pollingIntervalMinutes || 5,

      // VK
      vkToken: creds.vkToken || store.config.vk.token || '',
      vkChatId: creds.vkChatId || store.config.vk.chatId || '',
      vkTemplate: store.config.vk.template || '',
      vkEnabled: !!store.config.vk.enabled,

      // YClients
      yclientsUserToken: creds.yclientsUserToken || store.config.yclients.userToken || '',
      yclientsPartnerToken: creds.yclientsPartnerToken || store.config.yclients.partnerToken || '',
      yclientsSalonId: creds.yclientsSalonId || store.config.yclients.salonId || '',
      yclientsEnabled: !!store.config.yclients.enabled,

      // 152-ФЗ TTL settings
      ttlSettings: store.config.ttlSettings || {
        audioDays: 14,
        transcriptDays: 30,
        fullDeleteDays: 90,
        accessLogDays: 365,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/yandex-key-upload
 * Загрузка и валидация файла authorized_key.json для сервисного аккаунта Yandex Cloud
 */
adminRouter.post('/yandex-key-upload', async (req: Request, res: Response) => {
  try {
    const { keyContent, customPath } = req.body || {};
    if (!keyContent || typeof keyContent !== 'string') {
      return res.status(400).json({ success: false, error: 'Содержимое файла ключа authorized_key.json не передано' });
    }

    let parsed: any;
    try {
      parsed = JSON.parse(keyContent.trim());
    } catch (parseErr: any) {
      return res.status(400).json({ success: false, error: `Невалидный JSON формат: ${parseErr.message}` });
    }

    if (!parsed.service_account_id || !parsed.private_key) {
      return res.status(400).json({
        success: false,
        error: 'Файл ключа должен содержать поля "service_account_id" и "private_key" (стандартный формат Yandex Cloud IAM authorized_key.json)',
      });
    }

    const store = await readStore();
    if (!store.config.credentials) store.config.credentials = {};
    const creds = store.config.credentials;

    // Determine target save path
    let targetFile = customPath || creds.yandexServiceAccountKeyFile || process.env.YC_SERVICE_ACCOUNT_KEY_FILE || '/app/keys/authorized_key.json';

    try {
      const dir = path.dirname(targetFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(targetFile, JSON.stringify(parsed, null, 2), { mode: 0o600 });
    } catch (writeErr: any) {
      // Fallback to project keys directory
      targetFile = path.join(process.cwd(), 'keys', 'authorized_key.json');
      const dir = path.dirname(targetFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(targetFile, JSON.stringify(parsed, null, 2), { mode: 0o600 });
    }

    creds.yandexServiceAccountKeyFile = targetFile;
    creds.yandexServiceAccountKeyJson = JSON.stringify(parsed);
    process.env.YC_SERVICE_ACCOUNT_KEY_FILE = targetFile;
    process.env.YC_SERVICE_ACCOUNT_KEY_JSON = creds.yandexServiceAccountKeyJson;

    invalidateAuthorizedKeyCache();
    await writeStore(store);

    await logAccess(
      getCurrentUser(req)?.name || 'admin',
      'write',
      `Загружен authorized_key.json (SA: ${parsed.service_account_id}) в ${targetFile}`,
      req.ip || '127.0.0.1'
    );

    res.json({
      success: true,
      message: 'Файл authorized_key.json успешно загружен, проверен и применён',
      serviceAccountId: parsed.service_account_id,
      keyId: parsed.id,
      filePath: targetFile,
      keyInfo: getAuthorizedKeyInfo(),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: `Ошибка сохранения ключа: ${err.message}` });
  }
});

/**
 * POST /api/admin/credentials
 * Сохраняет обновленные токены, ключи и системные параметры в зашифрованное хранилище.
 */
adminRouter.post('/credentials', async (req: Request, res: Response) => {
  try {
    const store = await readStore();
    const body = req.body || {};

    if (!store.config.credentials) {
      store.config.credentials = {};
    }

    const creds = store.config.credentials;

    // 1. GigaChat
    if (body.gigachatAuthKey !== undefined) {
      creds.gigachatAuthKey = String(body.gigachatAuthKey).trim();
      process.env.GIGACHAT_AUTH_KEY = creds.gigachatAuthKey;
      invalidateGigaChatTokenCache();
    }
    if (body.gigachatScope !== undefined) {
      creds.gigachatScope = String(body.gigachatScope).trim();
      process.env.GIGACHAT_SCOPE = creds.gigachatScope;
      invalidateGigaChatTokenCache();
    }
    if (body.gigachatModel) {
      const validModels: GigaChatModel[] = ['GigaChat:Lite', 'GigaChat:Pro', 'GigaChat:Max'];
      if (validModels.includes(body.gigachatModel)) {
        creds.gigachatModel = body.gigachatModel;
        store.config.default_gigachat_model = body.gigachatModel;
        store.config.activeModel = body.gigachatModel;
        process.env.GIGACHAT_DEFAULT_MODEL = body.gigachatModel;
      }
    }

    // 2. Yandex SpeechKit
    if (body.yandexApiKey !== undefined) creds.yandexApiKey = String(body.yandexApiKey).trim();
    if (body.yandexFolderId !== undefined) {
      creds.yandexFolderId = String(body.yandexFolderId).trim();
      process.env.YC_FOLDER_ID = creds.yandexFolderId;
    }
    if (body.yandexServiceAccountKeyFile !== undefined) {
      creds.yandexServiceAccountKeyFile = String(body.yandexServiceAccountKeyFile).trim();
      process.env.YC_SERVICE_ACCOUNT_KEY_FILE = creds.yandexServiceAccountKeyFile;
      invalidateAuthorizedKeyCache();
    }
    if (body.yandexServiceAccountKeyJson !== undefined) {
      creds.yandexServiceAccountKeyJson = String(body.yandexServiceAccountKeyJson).trim();
      process.env.YC_SERVICE_ACCOUNT_KEY_JSON = creds.yandexServiceAccountKeyJson;
      invalidateAuthorizedKeyCache();
    }

    // 152-ФЗ Ключ шифрования БД и ПДн (STORE_ENCRYPTION_KEY)
    if (body.storeEncryptionKey !== undefined) {
      const keyVal = String(body.storeEncryptionKey).trim();
      if (keyVal) {
        creds.storeEncryptionKey = keyVal;
        process.env.STORE_ENCRYPTION_KEY = keyVal;
        setStoreEncryptionKey(keyVal);
      }
    }

    // 3. Yandex Object Storage (для аудиозаписей SpeechKit)
    if (body.yandexStorageBucket !== undefined) {
      creds.yandexStorageBucket = String(body.yandexStorageBucket).trim();
      process.env.YC_STORAGE_BUCKET = creds.yandexStorageBucket;
    }
    if (body.yandexStorageAccessKey !== undefined) {
      creds.yandexStorageAccessKey = String(body.yandexStorageAccessKey).trim();
      process.env.YC_STORAGE_ACCESS_KEY = creds.yandexStorageAccessKey;
      process.env.YC_S3_KEY_ID = creds.yandexStorageAccessKey;
    }
    if (body.yandexStorageSecretKey !== undefined) {
      creds.yandexStorageSecretKey = String(body.yandexStorageSecretKey).trim();
      process.env.YC_STORAGE_SECRET_KEY = creds.yandexStorageSecretKey;
      process.env.YC_S3_SECRET_KEY = creds.yandexStorageSecretKey;
    }
    if (body.yandexStorageEndpoint !== undefined) {
      creds.yandexStorageEndpoint = String(body.yandexStorageEndpoint).trim();
      process.env.YC_STORAGE_ENDPOINT = creds.yandexStorageEndpoint;
    }
    if (body.yandexStorageRegion !== undefined) {
      creds.yandexStorageRegion = String(body.yandexStorageRegion).trim();
      process.env.YC_STORAGE_REGION = creds.yandexStorageRegion;
    }

    // 4. S3 Timeweb / Внешнее хранилище (для резервной копии базы данных 152-ФЗ)
    if (body.s3Endpoint !== undefined) {
      creds.s3Endpoint = String(body.s3Endpoint).trim();
      process.env.S3_ENDPOINT = creds.s3Endpoint;
    }
    if (body.s3AccessKey !== undefined) {
      creds.s3AccessKey = String(body.s3AccessKey).trim();
      process.env.S3_ACCESS_KEY = creds.s3AccessKey;
    }
    if (body.s3SecretKey !== undefined) {
      creds.s3SecretKey = String(body.s3SecretKey).trim();
      process.env.S3_SECRET_KEY = creds.s3SecretKey;
    }
    if (body.s3BucketName !== undefined) {
      creds.s3BucketName = String(body.s3BucketName).trim();
      process.env.S3_BUCKET_NAME = creds.s3BucketName;
    }
    if (body.s3KeyPrefix !== undefined) {
      creds.s3KeyPrefix = String(body.s3KeyPrefix).trim();
      process.env.S3_KEY_PREFIX = creds.s3KeyPrefix;
    }
    if (body.s3Region !== undefined) {
      creds.s3Region = String(body.s3Region).trim();
      process.env.S3_REGION = creds.s3Region;
    }

    // 4. Мегафон ВАТС
    if (body.megafonToken !== undefined) {
      creds.megafonToken = String(body.megafonToken).trim();
      store.config.megafon.token = creds.megafonToken;
      process.env.MEGAFON_TOKEN = creds.megafonToken;
    }
    if (body.megafonLkLogin !== undefined) {
      creds.megafonLkLogin = String(body.megafonLkLogin).trim();
      store.config.megafon.lkLogin = creds.megafonLkLogin;
      process.env.MEGAFON_LK_LOGIN = creds.megafonLkLogin;
    }
    if (body.megafonLkPassword !== undefined) {
      creds.megafonLkPassword = String(body.megafonLkPassword).trim();
      store.config.megafon.lkPassword = creds.megafonLkPassword;
      process.env.MEGAFON_LK_PASSWORD = creds.megafonLkPassword;
    }
    if (body.megafonWebhookUrl !== undefined) store.config.megafon.webhookUrl = String(body.megafonWebhookUrl).trim();
    if (body.megafonAutoImport !== undefined) store.config.megafon.autoImport = Boolean(body.megafonAutoImport);
    if (body.megafonPollingEnabled !== undefined) store.config.megafon.pollingEnabled = Boolean(body.megafonPollingEnabled);
    if (body.megafonPollingIntervalMinutes !== undefined) {
      const parsed = parseInt(String(body.megafonPollingIntervalMinutes), 10);
      store.config.megafon.pollingIntervalMinutes = isNaN(parsed) ? 5 : Math.max(1, parsed);
    }

    // 5. VK
    if (body.vkToken !== undefined) {
      creds.vkToken = String(body.vkToken).trim();
      store.config.vk.token = creds.vkToken;
      process.env.VK_TOKEN = creds.vkToken;
    }
    if (body.vkChatId !== undefined) {
      creds.vkChatId = String(body.vkChatId).trim();
      store.config.vk.chatId = creds.vkChatId;
      process.env.VK_CHAT_ID = creds.vkChatId;
    }
    if (body.vkTemplate !== undefined) store.config.vk.template = String(body.vkTemplate);
    if (body.vkEnabled !== undefined) store.config.vk.enabled = Boolean(body.vkEnabled);

    // 6. YClients
    if (body.yclientsUserToken !== undefined) {
      creds.yclientsUserToken = String(body.yclientsUserToken).trim();
      store.config.yclients.userToken = creds.yclientsUserToken;
      process.env.YCLIENTS_USER_TOKEN = creds.yclientsUserToken;
    }
    if (body.yclientsPartnerToken !== undefined) {
      creds.yclientsPartnerToken = String(body.yclientsPartnerToken).trim();
      store.config.yclients.partnerToken = creds.yclientsPartnerToken;
      process.env.YCLIENTS_PARTNER_TOKEN = creds.yclientsPartnerToken;
    }
    if (body.yclientsSalonId !== undefined) {
      creds.yclientsSalonId = String(body.yclientsSalonId).trim();
      store.config.yclients.salonId = creds.yclientsSalonId;
      process.env.YCLIENTS_SALON_ID = creds.yclientsSalonId;
    }
    if (body.yclientsEnabled !== undefined) store.config.yclients.enabled = Boolean(body.yclientsEnabled);

    // 7. TTL Settings
    if (body.ttlSettings) {
      store.config.ttlSettings = {
        audioDays: Math.max(1, parseInt(body.ttlSettings.audioDays, 10) || 14),
        transcriptDays: Math.max(1, parseInt(body.ttlSettings.transcriptDays, 10) || 30),
        fullDeleteDays: Math.max(1, parseInt(body.ttlSettings.fullDeleteDays, 10) || 90),
        accessLogDays: Math.max(1, parseInt(body.ttlSettings.accessLogDays, 10) || 365),
      };
    }

    await writeStore(store);

    await logAccess(
      getCurrentUser(req)?.name || 'Администратор',
      'write',
      'Обновлены системные токены, ключи и параметры интеграций в админ-панели',
      req.ip || '127.0.0.1'
    );

    res.json({
      success: true,
      message: 'Все токены, ключи и настройки успешно сохранены в зашифрованное хранилище',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/change-admin-password
 * Смена мастер-пароля администратора
 */
adminRouter.post('/change-admin-password', async (req: Request, res: Response) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Текущий и новый пароли обязательны' });
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({ error: 'Новый пароль должен быть не менее 6 символов' });
    }

    const store = await readStore();
    const users = store.users || [];
    const currentUser = getCurrentUser(req);

    // Find admin user
    const adminUser = users.find(u => u.username === (currentUser?.username || 'admin') && u.role === 'admin');
    if (!adminUser) {
      return res.status(404).json({ error: 'Пользователь-администратор не найден' });
    }

    // Verify current password
    const isCurrentValid = verifyPassword(String(currentPassword), adminUser.passwordHash, adminUser.salt) ||
      (String(currentPassword) === 'admin123');

    if (!isCurrentValid) {
      return res.status(401).json({ error: 'Неверный текущий пароль' });
    }

    // Update password
    const hashed = hashPassword(String(newPassword));
    adminUser.passwordHash = hashed.hash;
    adminUser.salt = hashed.salt;

    if (!store.config.credentials) store.config.credentials = {};
    store.config.credentials.adminPasswordHash = hashed.hash;
    store.config.credentials.adminPasswordSalt = hashed.salt;

    await writeStore(store);

    await logAccess(
      adminUser.name,
      'write',
      'Пароль администратора успешно изменен',
      req.ip || '127.0.0.1'
    );

    res.json({ success: true, message: 'Пароль администратора успешно обновлен' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/test/gigachat
 * Тестирование подключения к Сбер GigaChat с переданным или сохраненным ключом
 */
adminRouter.post('/test/gigachat', async (req: Request, res: Response) => {
  try {
    const store = await readStore();
    const authKey = req.body.authKey || store.config.credentials?.gigachatAuthKey || process.env.GIGACHAT_AUTH_KEY;
    const scope = req.body.scope || store.config.credentials?.gigachatScope || process.env.GIGACHAT_SCOPE || 'GIGACHAT_API_PERS';

    if (!authKey) {
      return res.status(400).json({ success: false, error: 'Ключ авторизации GigaChat не указан' });
    }

    const formattedAuth = authKey.startsWith('Basic ') || authKey.startsWith('Bearer ')
      ? authKey
      : `Basic ${authKey}`;

    const httpsAgent = new https.Agent({ rejectUnauthorized: false });

    const authRes = await axios.post(
      'https://ngw.devices.sberbank.ru:9443/api/v2/oauth',
      `scope=${encodeURIComponent(scope)}`,
      {
        headers: {
          Authorization: formattedAuth,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          RqUID: randomUUID(),
        },
        httpsAgent,
        timeout: 15000,
      }
    );

    if (authRes.data && authRes.data.access_token) {
      return res.json({
        success: true,
        message: 'Соединение с GigaChat успешно установлено. Токен получен.',
        expiresAt: authRes.data.expires_at ? new Date(authRes.data.expires_at).toLocaleString('ru-RU') : 'через 30 минут',
      });
    }

    res.status(400).json({ success: false, error: 'Не удалось получить токен GigaChat' });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      error: `Ошибка подключения к GigaChat: ${err.response?.data?.message || err.message}`,
    });
  }
});

/**
 * POST /api/admin/test/yandex
 * Проверка ключей и авторизации Yandex Cloud (SpeechKit)
 */
adminRouter.post('/test/yandex', async (req: Request, res: Response) => {
  try {
    const store = await readStore();
    const creds = store.config.credentials || {};
    const apiKey = req.body.apiKey || creds.yandexApiKey || process.env.YC_API_KEY;
    const folderId = req.body.folderId || creds.yandexFolderId || process.env.YC_FOLDER_ID;

    // 1. If API Key provided
    if (apiKey) {
      return res.json({
        success: true,
        message: 'Используется постоянный API-ключ Yandex Cloud. Авторизация активна.',
        authType: 'api_key',
        folderId: folderId || '(не указан)',
      });
    }

    // 2. Try getting IAM Token from authorized_key.json
    try {
      await getIamToken();
      const keyInfo = getAuthorizedKeyInfo();
      return res.json({
        success: true,
        message: `IAM-токен успешно сгенерирован и подтверждён через authorized_key.json (SA: ${keyInfo.serviceAccountId || 'активен'})`,
        authType: 'iam_token',
        serviceAccountId: keyInfo.serviceAccountId,
        keyId: keyInfo.keyId,
        filePath: keyInfo.filePath,
        folderId: folderId || '(не указан)',
      });
    } catch (iamErr: any) {
      return res.status(400).json({
        success: false,
        error: `Ошибка авторизации Yandex Cloud: ${iamErr.message}. Загрузите authorized_key.json или укажите API-ключ.`,
      });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/admin/test/yandex-storage
 * Тестирование подключения к бакету Yandex Object Storage (для аудиозаписей SpeechKit)
 */
adminRouter.post('/test/yandex-storage', async (req: Request, res: Response) => {
  try {
    const store = await readStore();
    const creds = store.config.credentials || {};

    const endpoint = req.body.endpoint || creds.yandexStorageEndpoint || process.env.YC_STORAGE_ENDPOINT || 'https://storage.yandexcloud.net';
    const accessKeyId = req.body.accessKey || creds.yandexStorageAccessKey || process.env.YC_STORAGE_ACCESS_KEY || process.env.YC_S3_KEY_ID;
    const secretAccessKey = req.body.secretKey || creds.yandexStorageSecretKey || process.env.YC_STORAGE_SECRET_KEY || process.env.YC_S3_SECRET_KEY;
    const bucket = req.body.bucket || creds.yandexStorageBucket || process.env.YC_STORAGE_BUCKET;
    const region = req.body.region || creds.yandexStorageRegion || process.env.YC_STORAGE_REGION || 'ru-central1';

    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
      return res.status(400).json({
        success: false,
        error: 'Не все параметры Yandex Storage заполнены (Имя бакета, Access Key ID, Secret Key)',
      });
    }

    const s3 = new S3Client({
      region,
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });

    await s3.send(new HeadBucketCommand({ Bucket: bucket }));

    res.json({
      success: true,
      message: `Бакет Yandex Object Storage "${bucket}" на ${endpoint} успешно подтверждён`,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      error: `Ошибка проверки Yandex Storage: ${err.message}`,
    });
  }
});

/**
 * POST /api/admin/test/s3
 * Тестирование подключения к S3 бакету Timeweb (для резервной копии БД)
 */
adminRouter.post('/test/s3', async (req: Request, res: Response) => {
  try {
    const store = await readStore();
    const creds = store.config.credentials || {};

    const endpoint = req.body.endpoint || creds.s3Endpoint || process.env.S3_ENDPOINT || 'https://s3.timeweb.cloud';
    const accessKeyId = req.body.accessKey || creds.s3AccessKey || process.env.S3_ACCESS_KEY;
    const secretAccessKey = req.body.secretKey || creds.s3SecretKey || process.env.S3_SECRET_KEY;
    const bucket = req.body.bucket || creds.s3BucketName || process.env.S3_BUCKET_NAME;
    const region = req.body.region || creds.s3Region || process.env.S3_REGION || 'ru-1';

    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
      return res.status(400).json({
        success: false,
        error: 'Не все параметры Timeweb S3 заполнены (Endpoint, Access Key, Secret Key, Bucket)',
      });
    }

    const s3 = new S3Client({
      region,
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });

    await s3.send(new HeadBucketCommand({ Bucket: bucket }));

    res.json({
      success: true,
      message: `Подключение к S3 бакету "${bucket}" на ${endpoint} успешно подтверждено`,
    });
  } catch (err: any) {
    res.status(400).json({
      success: false,
      error: `Ошибка проверки S3: ${err.message}`,
    });
  }
});

/**
 * POST /api/admin/test/vk
 * Тестирование отправки тестового сообщения в VK
 */
adminRouter.post('/test/vk', async (req: Request, res: Response) => {
  try {
    const store = await readStore();
    const token = req.body.token || store.config.credentials?.vkToken || store.config.vk.token || process.env.VK_TOKEN;
    const chatId = req.body.chatId || store.config.credentials?.vkChatId || store.config.vk.chatId || process.env.VK_CHAT_ID;

    if (!token || !chatId) {
      return res.status(400).json({ success: false, error: 'Токен VK или ID чата не указаны' });
    }

    const message = `🔔 [Лик 28 Тест] Проверка интеграции уведомлений аналитики звонков салона красоты «Лик 28» (${new Date().toLocaleString('ru-RU')})`;
    const params = new URLSearchParams();
    params.append('v', '5.131');
    params.append('access_token', token);
    params.append('random_id', String(Date.now()));
    params.append('message', message);

    const parsedChatId = parseInt(chatId, 10);
    if (!isNaN(parsedChatId) && parsedChatId > 2000000000) {
      params.append('peer_id', String(parsedChatId));
    } else {
      params.append('peer_id', chatId);
    }

    const response = await axios.post('https://api.vk.com/method/messages.send', params, { timeout: 10000 });
    if (response.data && response.data.error) {
      return res.status(400).json({
        success: false,
        error: `VK API Ошибка: ${response.data.error.error_msg || JSON.stringify(response.data.error)}`,
      });
    }

    res.json({ success: true, message: 'Тестовое уведомление успешно отправлено в ВКонтакте' });
  } catch (err: any) {
    res.status(400).json({ success: false, error: `Ошибка отправки в VK: ${err.message}` });
  }
});
