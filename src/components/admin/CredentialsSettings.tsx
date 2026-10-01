/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Key, Lock, Server, Shield, MessageCircle, Database, Cloud,
  HelpCircle, Calendar, RefreshCw, Clock, Globe, Zap, 
  CheckCircle2, AlertTriangle, Trash2, Cpu, Eye, EyeOff, Save, AlertCircle,
  Upload, FileCode, Folder, Copy, Check, FileCheck, ChevronDown, ChevronUp
} from 'lucide-react';
import { GigaChatModel } from '../../types.js';
import { S3SyncPanel } from '../S3SyncPanel.js';

interface CredentialsSettingsProps {
  authToken?: string | null;
}

export function CredentialsSettings({ authToken }: CredentialsSettingsProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Field states
  const [showKeys, setShowKeys] = useState(false);

  // GigaChat
  const [gigachatAuthKey, setGigachatAuthKey] = useState('');
  const [gigachatModel, setGigachatModel] = useState<GigaChatModel>('GigaChat:Lite');
  const [gigachatScope, setGigachatScope] = useState<'GIGACHAT_API_PERS' | 'GIGACHAT_API_B2B' | 'GIGACHAT_API_CORP'>('GIGACHAT_API_PERS');
  const [testingGiga, setTestingGiga] = useState(false);
  const [gigaTestResult, setGigaTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [queueStatus, setQueueStatus] = useState<{ pending: number; isProcessing: boolean; totalProcessed: number } | null>(null);

  // 152-ФЗ Шифрование (STORE_ENCRYPTION_KEY)
  const [storeEncryptionKey, setStoreEncryptionKey] = useState('');
  const [showStoreEncryptionKey, setShowStoreEncryptionKey] = useState(false);
  const [storeEncryptionKeyConfigured, setStoreEncryptionKeyConfigured] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  // Yandex SpeechKit & IAM Authorized Key
  const [yandexApiKey, setYandexApiKey] = useState('');
  const [yandexFolderId, setYandexFolderId] = useState('');
  const [yandexServiceAccountId, setYandexServiceAccountId] = useState('');
  const [geminiConfigured, setGeminiConfigured] = useState(false);
  const [yandexServiceAccountKeyFile, setYandexServiceAccountKeyFile] = useState('/app/keys/authorized_key.json');
  const [yandexServiceAccountKeyJson, setYandexServiceAccountKeyJson] = useState('');
  const [yandexKeyInfo, setYandexKeyInfo] = useState<{
    configured: boolean;
    serviceAccountId?: string;
    keyId?: string;
    source?: string;
    filePath?: string;
    fileSizeBytes?: number;
    lastModified?: string;
  }>({ configured: false });
  const [uploadingYandexKey, setUploadingYandexKey] = useState(false);
  const [yandexUploadResult, setYandexUploadResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testingYandex, setTestingYandex] = useState(false);
  const [yandexTestResult, setYandexTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [showAdvancedYandex, setShowAdvancedYandex] = useState(false);

  // Yandex Object Storage (для аудиозаписей SpeechKit >= 1MB)
  const [yandexStorageBucket, setYandexStorageBucket] = useState('');
  const [yandexStorageAccessKey, setYandexStorageAccessKey] = useState('');
  const [yandexStorageSecretKey, setYandexStorageSecretKey] = useState('');
  const [yandexStorageEndpoint, setYandexStorageEndpoint] = useState('https://storage.yandexcloud.net');
  const [yandexStorageRegion, setYandexStorageRegion] = useState('ru-central1');
  const [testingYandexStorage, setTestingYandexStorage] = useState(false);
  const [yandexStorageTestResult, setYandexStorageTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // S3 Timeweb / Резервное хранилище базы данных 152-ФЗ
  const [s3Endpoint, setS3Endpoint] = useState('https://s3.timeweb.cloud');
  const [s3AccessKey, setS3AccessKey] = useState('');
  const [s3SecretKey, setS3SecretKey] = useState('');
  const [s3BucketName, setS3BucketName] = useState('');
  const [s3KeyPrefix, setS3KeyPrefix] = useState('lik28/data/');
  const [s3Region, setS3Region] = useState('ru-1');
  const [testingS3, setTestingS3] = useState(false);
  const [s3TestResult, setS3TestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Мегафон ВАТС
  const [megafonToken, setMegafonToken] = useState('');
  const [megafonLkLogin, setMegafonLkLogin] = useState('');
  const [megafonLkPassword, setMegafonLkPassword] = useState('');
  const [megafonWebhookUrl, setMegafonWebhookUrl] = useState('/api/calls/webhook');
  const [megafonAutoImport, setMegafonAutoImport] = useState(true);
  const [megafonPollingEnabled, setMegafonPollingEnabled] = useState(false);
  const [megafonPollingIntervalMinutes, setMegafonPollingIntervalMinutes] = useState(15);

  // Период ручного опроса Мегафон
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date(Date.now() - 12 * 3600000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [toDate, setToDate] = useState(() => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [syncingPeriod, setSyncingPeriod] = useState(false);
  const [syncPeriodResult, setSyncPeriodResult] = useState<string | null>(null);

  // VK
  const [vkToken, setVkToken] = useState('');
  const [vkChatId, setVkChatId] = useState('');
  const [vkTemplate, setVkTemplate] = useState('');
  const [vkEnabled, setVkEnabled] = useState(true);
  const [testingVk, setTestingVk] = useState(false);
  const [vkTestResult, setVkTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // YClients
  const [yclientsUserToken, setYclientsUserToken] = useState('');
  const [yclientsPartnerToken, setYclientsPartnerToken] = useState('');
  const [yclientsSalonId, setYclientsSalonId] = useState('');
  const [yclientsEnabled, setYclientsEnabled] = useState(true);

  // TTL
  const [ttlAudioDays, setTtlAudioDays] = useState(14);
  const [ttlTranscriptDays, setTtlTranscriptDays] = useState(30);
  const [ttlFullDeleteDays, setTtlFullDeleteDays] = useState(90);
  const [runningCleanup, setRunningCleanup] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<any | null>(null);

  const getHeaders = () => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) h['Authorization'] = `Bearer ${authToken}`;
    return h;
  };

  const loadCredentials = async () => {
    setLoading(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/admin/credentials', { headers: getHeaders() });
      if (!res.ok) throw new Error('Не удалось загрузить системные настройки');
      const data = await res.json();

      setGigachatAuthKey(data.gigachatAuthKey || '');
      setGigachatModel(data.gigachatModel || 'GigaChat:Lite');
      if (data.gigachatScope) {
        setGigachatScope(data.gigachatScope);
      }

      setStoreEncryptionKey(data.storeEncryptionKey || '');
      setStoreEncryptionKeyConfigured(!!data.storeEncryptionKeyConfigured);

      setYandexApiKey(data.yandexApiKey || '');
      setYandexFolderId(data.yandexFolderId || '');
      setYandexServiceAccountId(data.yandexServiceAccountId || '');
      setGeminiConfigured(!!data.geminiConfigured);
      setYandexServiceAccountKeyFile(data.yandexServiceAccountKeyFile || '/app/keys/authorized_key.json');
      setYandexServiceAccountKeyJson(data.yandexServiceAccountKeyJson || '');
      if (data.yandexKeyInfo) {
        setYandexKeyInfo(data.yandexKeyInfo);
      }

      // Yandex Object Storage
      setYandexStorageBucket(data.yandexStorageBucket || '');
      setYandexStorageAccessKey(data.yandexStorageAccessKey || '');
      setYandexStorageSecretKey(data.yandexStorageSecretKey || '');
      setYandexStorageEndpoint(data.yandexStorageEndpoint || 'https://storage.yandexcloud.net');
      setYandexStorageRegion(data.yandexStorageRegion || 'ru-central1');

      // S3 Timeweb
      setS3Endpoint(data.s3Endpoint || 'https://s3.timeweb.cloud');
      setS3AccessKey(data.s3AccessKey || '');
      setS3SecretKey(data.s3SecretKey || '');
      setS3BucketName(data.s3BucketName || '');
      setS3KeyPrefix(data.s3KeyPrefix || 'lik28/data/');
      setS3Region(data.s3Region || 'ru-1');

      setMegafonToken(data.megafonToken || '');
      setMegafonLkLogin(data.megafonLkLogin || '');
      setMegafonLkPassword(data.megafonLkPassword || '');
      setMegafonWebhookUrl(data.megafonWebhookUrl || '/api/calls/webhook');
      setMegafonAutoImport(data.megafonAutoImport !== false);
      setMegafonPollingEnabled(!!data.megafonPollingEnabled);
      setMegafonPollingIntervalMinutes(data.megafonPollingIntervalMinutes || 15);

      setVkToken(data.vkToken || '');
      setVkChatId(data.vkChatId || '');
      setVkTemplate(data.vkTemplate || '');
      setVkEnabled(!!data.vkEnabled);

      setYclientsUserToken(data.yclientsUserToken || '');
      setYclientsPartnerToken(data.yclientsPartnerToken || '');
      setYclientsSalonId(data.yclientsSalonId || '');
      setYclientsEnabled(!!data.yclientsEnabled);

      if (data.ttlSettings) {
        setTtlAudioDays(data.ttlSettings.audioDays || 14);
        setTtlTranscriptDays(data.ttlSettings.transcriptDays || 30);
        setTtlFullDeleteDays(data.ttlSettings.fullDeleteDays || 90);
      }
    } catch (err: any) {
      setSaveError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchQueue = async () => {
    try {
      const res = await fetch('/api/gigachat/queue', { headers: getHeaders() });
      if (res.ok) {
        const d = await res.json();
        setQueueStatus(d.queue);
      }
    } catch {}
  };

  useEffect(() => {
    loadCredentials();
    fetchQueue();
    const interval = setInterval(fetchQueue, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleSaveAll = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSaving(true);
    setSaveSuccess(null);
    setSaveError(null);

    try {
      const body = {
        gigachatAuthKey,
        gigachatModel,
        gigachatScope,
        storeEncryptionKey,
        yandexApiKey,
        yandexFolderId,
        yandexServiceAccountId,
        yandexServiceAccountKeyFile,
        yandexServiceAccountKeyJson,
        yandexStorageBucket,
        yandexStorageAccessKey,
        yandexStorageSecretKey,
        yandexStorageEndpoint,
        yandexStorageRegion,
        s3Endpoint,
        s3AccessKey,
        s3SecretKey,
        s3BucketName,
        s3KeyPrefix,
        s3Region,
        megafonToken,
        megafonLkLogin,
        megafonLkPassword,
        megafonWebhookUrl,
        megafonAutoImport,
        megafonPollingEnabled,
        megafonPollingIntervalMinutes,
        vkToken,
        vkChatId,
        vkTemplate,
        vkEnabled,
        yclientsUserToken,
        yclientsPartnerToken,
        yclientsSalonId,
        yclientsEnabled,
        ttlSettings: {
          audioDays: ttlAudioDays,
          transcriptDays: ttlTranscriptDays,
          fullDeleteDays: ttlFullDeleteDays,
          accessLogDays: 365,
        },
      };

      const res = await fetch('/api/admin/credentials', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка сохранения настроек');

      setSaveSuccess(data.message || 'Все настройки, ключи и токены успешно сохранены');
      if (storeEncryptionKey) {
        setStoreEncryptionKeyConfigured(true);
      }
    } catch (err: any) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateEncryptionKey = () => {
    const array = new Uint8Array(32);
    window.crypto.getRandomValues(array);
    const hexKey = Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
    setStoreEncryptionKey(hexKey);
    setShowStoreEncryptionKey(true);
    setSaveSuccess('Сгенерирован криптостойкий 256-битный ключ (64 hex). Сохраните настройки для активации!');
  };

  const handleCopyEncryptionKey = async () => {
    if (!storeEncryptionKey) return;
    try {
      await navigator.clipboard.writeText(storeEncryptionKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleUploadAuthorizedKey = async (file: File) => {
    setUploadingYandexKey(true);
    setYandexUploadResult(null);
    try {
      const text = await file.text();
      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch (err: any) {
        throw new Error('Файл не является валидным JSON: ' + err.message);
      }

      if (!parsed.service_account_id && !parsed.id && !parsed.private_key) {
        throw new Error('Файл authorized_key.json должен содержать поля service_account_id и private_key');
      }

      const res = await fetch('/api/admin/yandex-key-upload', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          keyContent: text,
          customPath: yandexServiceAccountKeyFile || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Ошибка сохранения файла на сервере');
      }

      setYandexUploadResult({
        ok: true,
        msg: `Ключ успешно загружен! Сервисный аккаунт: ${data.serviceAccountId || 'подтвержден'}`,
      });
      if (data.filePath) {
        setYandexServiceAccountKeyFile(data.filePath);
      }
      if (data.keyInfo) {
        setYandexKeyInfo(data.keyInfo);
      }
      setYandexServiceAccountKeyJson(text);
    } catch (err: any) {
      setYandexUploadResult({ ok: false, msg: err.message });
    } finally {
      setUploadingYandexKey(false);
    }
  };

  const handleTestYandex = async () => {
    setTestingYandex(true);
    setYandexTestResult(null);
    try {
      const res = await fetch('/api/admin/test/yandex', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          apiKey: yandexApiKey,
          folderId: yandexFolderId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setYandexTestResult({ ok: true, msg: data.message });
      } else {
        setYandexTestResult({ ok: false, msg: data.error || 'Ошибка проверки авторизации Yandex Cloud' });
      }
    } catch (err: any) {
      setYandexTestResult({ ok: false, msg: err.message });
    } finally {
      setTestingYandex(false);
    }
  };

  const handleTestYandexStorage = async () => {
    setTestingYandexStorage(true);
    setYandexStorageTestResult(null);
    try {
      const res = await fetch('/api/admin/test/yandex-storage', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          endpoint: yandexStorageEndpoint,
          accessKey: yandexStorageAccessKey,
          secretKey: yandexStorageSecretKey,
          bucket: yandexStorageBucket,
          region: yandexStorageRegion,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setYandexStorageTestResult({ ok: true, msg: data.message });
      } else {
        setYandexStorageTestResult({ ok: false, msg: data.error || 'Ошибка проверки Yandex Storage' });
      }
    } catch (err: any) {
      setYandexStorageTestResult({ ok: false, msg: err.message });
    } finally {
      setTestingYandexStorage(false);
    }
  };

  const applyTimewebStoragePreset = () => {
    setS3Endpoint('https://s3.timeweb.cloud');
    setS3Region('ru-1');
  };

  const handleTestGigaChat = async () => {
    setTestingGiga(true);
    setGigaTestResult(null);
    try {
      const res = await fetch('/api/admin/test/gigachat', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ authKey: gigachatAuthKey, scope: gigachatScope }),
      });
      const data = await res.json();
      if (data.success) {
        setGigaTestResult({ ok: true, msg: `${data.message} (${data.expiresAt || ''})` });
      } else {
        setGigaTestResult({ ok: false, msg: data.error || 'Ошибка проверки' });
      }
      fetchQueue();
    } catch (err: any) {
      setGigaTestResult({ ok: false, msg: err.message });
    } finally {
      setTestingGiga(false);
    }
  };

  const handleTestS3 = async () => {
    setTestingS3(true);
    setS3TestResult(null);
    try {
      const res = await fetch('/api/admin/test/s3', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          endpoint: s3Endpoint,
          accessKey: s3AccessKey,
          secretKey: s3SecretKey,
          bucket: s3BucketName,
          region: s3Region,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setS3TestResult({ ok: true, msg: data.message });
      } else {
        setS3TestResult({ ok: false, msg: data.error || 'Сбой S3' });
      }
    } catch (err: any) {
      setS3TestResult({ ok: false, msg: err.message });
    } finally {
      setTestingS3(false);
    }
  };

  const handleTestVk = async () => {
    setTestingVk(true);
    setVkTestResult(null);
    try {
      const res = await fetch('/api/admin/test/vk', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ token: vkToken, chatId: vkChatId }),
      });
      const data = await res.json();
      if (data.success) {
        setVkTestResult({ ok: true, msg: data.message });
      } else {
        setVkTestResult({ ok: false, msg: data.error || 'Ошибка отправки в VK' });
      }
    } catch (err: any) {
      setVkTestResult({ ok: false, msg: err.message });
    } finally {
      setTestingVk(false);
    }
  };

  const handleManualPeriodSync = async () => {
    setSyncingPeriod(true);
    setSyncPeriodResult(null);
    try {
      const start = new Date(fromDate).toISOString();
      const end = new Date(toDate).toISOString();
      const res = await fetch('/api/calls/poll-now', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ start, end }),
      });
      const text = await res.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(res.ok ? 'Некорректный формат ответа сервера' : `Ошибка сервера (${res.status}): ${text.slice(0, 120)}`);
      }

      if (res.ok && data.success) {
        setSyncPeriodResult(`Успешно! Добавлено звонков: ${data.importedCount ?? data.imported ?? 0}`);
      } else {
        setSyncPeriodResult(`Ошибка: ${data.error || 'Не удалось выполнить опрос АТС'}`);
      }
    } catch (err: any) {
      setSyncPeriodResult(`Ошибка: ${err.message}`);
    } finally {
      setSyncingPeriod(false);
    }
  };

  const handleRunCleanupNow = async () => {
    if (!confirm('Запустить немедленное удаление просроченных аудиозаписей и деперсонализацию по 152-ФЗ?')) return;
    setRunningCleanup(true);
    setCleanupResult(null);
    try {
      const res = await fetch('/api/settings/cleanup-now', {
        method: 'POST',
        headers: getHeaders(),
      });
      const data = await res.json();
      setCleanupResult(data.result || data);
    } catch (err: any) {
      alert(`Ошибка очистки: ${err.message}`);
    } finally {
      setRunningCleanup(false);
    }
  };

  return (
    <form onSubmit={handleSaveAll} className="space-y-6" id="credentials-settings-form">
      {/* Top Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Key className="w-4 h-4 text-emerald-600" />
            Управление токенами, API-ключами и внешними сервисами
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Все секретные ключи шифруются по алгоритму AES-256-GCM в файле <code>data-store.enc</code>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowKeys(!showKeys)}
            className="px-3 py-2 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 transition-colors flex items-center gap-1.5"
          >
            {showKeys ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {showKeys ? 'Скрыть токены' : 'Показать токены'}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
            id="save-all-credentials-btn"
          >
            <Save className="w-4 h-4" /> {saving ? 'Сохранение...' : 'Сохранить все настройки'}
          </button>
        </div>
      </div>

      {/* Status Alerts */}
      {saveError && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-rose-800">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span>{saveError}</span>
        </div>
      )}
      {saveSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-emerald-800">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <span>{saveSuccess}</span>
        </div>
      )}

      {/* Grid of Integrations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        
        {/* 1. GigaChat (Сбер) */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-emerald-50 text-emerald-700 rounded-xl">
                <Cpu className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-xs">Сбер GigaChat (ИИ-Анализ звонков)</h4>
                <p className="text-[11px] text-slate-500">Авторизация через Минцифры TLS • FIFO Очередь</p>
              </div>
            </div>
            <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full">
              Реестр РФ
            </span>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Ключ авторизации GigaChat (GIGACHAT_AUTH_KEY)*
            </label>
            <input
              type={showKeys ? 'text' : 'password'}
              value={gigachatAuthKey}
              onChange={(e) => setGigachatAuthKey(e.target.value)}
              placeholder="Basic M2QxOW... (Base64 Client ID + Secret)"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-hidden"
              id="admin-gigachat-key-input"
            />
          </div>

          {/* Scope selection */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Тип учётной записи (Scope)
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'GIGACHAT_API_PERS', label: 'Физлица (PERS)' },
                { id: 'GIGACHAT_API_B2B', label: 'Юрлица / ИП (B2B)' },
                { id: 'GIGACHAT_API_CORP', label: 'Корпоративный (CORP)' },
              ].map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setGigachatScope(s.id as any)}
                  className={`py-1.5 px-2 text-[11px] font-bold rounded-xl border text-center transition-all ${
                    gigachatScope === s.id
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-slate-500 mt-1">
              Для ключей из личного кабинета физического лица выберите PERS, для договоров юрлица/ИП — B2B.
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Модель по умолчанию</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(['GigaChat:Lite', 'GigaChat:Pro', 'GigaChat:Max', 'GigaChat:Ultra'] as GigaChatModel[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setGigachatModel(m)}
                  className={`py-2 px-2 text-xs font-bold rounded-xl border text-center transition-all ${
                    gigachatModel === m
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {m.replace('GigaChat:', '')}
                </button>
              ))}
            </div>
          </div>

          {/* Queue & Retry Monitor */}
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs space-y-1.5">
            <div className="flex justify-between items-center text-[11px] font-bold text-slate-700">
              <span>FIFO Очередь запросов (лимит 1 одновр.):</span>
              <span className={queueStatus?.isProcessing ? 'text-amber-600' : 'text-emerald-600'}>
                {queueStatus?.isProcessing ? '⚡ Выполняется запрос' : '💤 Свободна'}
              </span>
            </div>
            <div className="flex justify-between text-[11px] text-slate-500">
              <span>В очереди ожидания:</span>
              <span className="font-mono font-bold">{queueStatus?.pending ?? 0}</span>
            </div>
            <div className="flex justify-between text-[11px] text-slate-500">
              <span>Обработано с перезапуска:</span>
              <span className="font-mono font-bold">{queueStatus?.totalProcessed ?? 0}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleTestGigaChat}
              disabled={testingGiga}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5"
            >
              <Zap className="w-3.5 h-3.5 text-amber-500" />
              {testingGiga ? 'Проверка...' : 'Проверить соединение'}
            </button>
            {gigaTestResult && (
              <span className={`text-[11px] font-medium ${gigaTestResult.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
                {gigaTestResult.msg}
              </span>
            )}
          </div>
        </div>

        {/* 2. Yandex SpeechKit & Сервисный аккаунт */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4" id="yandex-cloud-card">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-red-50 text-red-700 rounded-xl">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-xs">Yandex SpeechKit (Распознавание речи)</h4>
                <p className="text-[11px] text-slate-500">API-ключ или сервисный аккаунт IAM • 2-канальная транскрибация</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {geminiConfigured && (
                <span className="text-[10px] bg-blue-50 text-blue-700 font-bold px-2 py-0.5 rounded-full border border-blue-200">
                  Резерв Gemini активен
                </span>
              )}
              <span className="text-[10px] bg-red-100 text-red-800 font-bold px-2 py-0.5 rounded-full">
                Российское облако
              </span>
            </div>
          </div>

          {/* 1. Постоянный API-ключ Yandex Cloud (Основной / Рекомендуемый способ) */}
          <div className="p-3 bg-red-50/50 rounded-xl border border-red-100 space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-slate-800">
                Постоянный API-ключ Yandex Cloud (YC_API_KEY)
              </label>
              <span className="text-[10px] text-red-700 font-semibold bg-red-100/80 px-2 py-0.5 rounded">
                Рекомендуемый способ
              </span>
            </div>
            <input
              type={showKeys ? 'text' : 'password'}
              value={yandexApiKey}
              onChange={(e) => setYandexApiKey(e.target.value)}
              placeholder="AQVN..."
              className="w-full px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-mono focus:ring-2 focus:ring-red-500 focus:bg-white focus:outline-hidden"
              id="yandex-api-key-input"
            />
            <p className="text-[10px] text-slate-500">
              Постоянный ключ для доступа к Yandex SpeechKit. Создаётся в консоли Yandex Cloud (Сервисные аккаунты → Создать API-ключ).
              <span className="block mt-0.5 text-amber-700 font-medium">Важно: копируйте именно <b>Секретный ключ</b> (начинается на AQVN...), а не Идентификатор ключа (aje...).</span>
            </p>
          </div>

          {/* Folder ID & Service Account ID */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Идентификатор каталога (Folder ID)
              </label>
              <input
                type="text"
                value={yandexFolderId}
                onChange={(e) => setYandexFolderId(e.target.value)}
                placeholder="b1g..."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:ring-2 focus:ring-red-500 focus:bg-white focus:outline-hidden"
                id="yandex-folder-id-input"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Каталог в Yandex Cloud (например: b1gv4k2...)
              </p>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Идентификатор сервисного аккаунта (SA ID)
              </label>
              <input
                type="text"
                value={yandexServiceAccountId}
                onChange={(e) => setYandexServiceAccountId(e.target.value)}
                placeholder="aje..."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:ring-2 focus:ring-red-500 focus:bg-white focus:outline-hidden"
                id="yandex-sa-id-input"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                ID сервисного аккаунта (для IAM-токенов)
              </p>
            </div>
          </div>

          {/* Загрузка authorized_key.json через админ-панель */}
          <div className="bg-slate-50 p-3.5 rounded-xl border border-dashed border-slate-300 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Upload className="w-3.5 h-3.5 text-red-600" />
                Авторизованный ключ authorized_key.json
              </span>
              <label className="cursor-pointer px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1.5">
                <FileCode className="w-3.5 h-3.5" />
                {uploadingYandexKey ? 'Загрузка...' : 'Выбрать файл ключа'}
                <input
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  disabled={uploadingYandexKey}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUploadAuthorizedKey(file);
                    e.target.value = '';
                  }}
                  id="yandex-key-file-upload-input"
                />
              </label>
            </div>

            <p className="text-[11px] text-slate-500 leading-relaxed">
              Альтернатива: загрузите JSON-файл ключа сервисного аккаунта для автоматической генерации IAM-токенов.
            </p>

            {/* Статус авторизованного ключа */}
            {yandexKeyInfo?.configured ? (
              <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-[11px] text-emerald-900 space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-emerald-800">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  Авторизованный ключ подключен и проверен
                </div>
                {yandexKeyInfo.serviceAccountId && (
                  <div className="font-mono text-[10px] text-emerald-700">
                    Service Account ID: <span className="font-bold">{yandexKeyInfo.serviceAccountId}</span>
                  </div>
                )}
                {yandexKeyInfo.keyId && (
                  <div className="font-mono text-[10px] text-emerald-700">
                    Key ID: {yandexKeyInfo.keyId}
                  </div>
                )}
              </div>
            ) : (
              <div className="p-2.5 bg-slate-100 border border-slate-200 rounded-lg text-[11px] text-slate-600 flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-slate-500 shrink-0 mt-0.5" />
                <span>Если вы используете постоянный API-ключ (выше), загрузка authorized_key.json не требуется.</span>
              </div>
            )}

            {yandexUploadResult && (
              <div className={`p-2 rounded-lg text-[11px] font-medium ${yandexUploadResult.ok ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                {yandexUploadResult.msg}
              </div>
            )}
          </div>

          {/* Путь к файлу authorized_key.json */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Путь к файлу ключа authorized_key.json на сервере
            </label>
            <div className="relative">
              <input
                type="text"
                value={yandexServiceAccountKeyFile}
                onChange={(e) => setYandexServiceAccountKeyFile(e.target.value)}
                placeholder="/app/keys/authorized_key.json"
                className="w-full px-3 py-2 pl-8 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:ring-2 focus:ring-red-500 focus:bg-white focus:outline-hidden"
                id="yandex-key-file-input"
              />
              <Folder className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5" />
            </div>
          </div>

          {/* Кнопка проверки авторизации Yandex Cloud */}
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleTestYandex}
              disabled={testingYandex}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5"
              id="test-yandex-auth-btn"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${testingYandex ? 'animate-spin text-red-600' : ''}`} />
              {testingYandex ? 'Проверка...' : 'Проверить авторизацию Yandex'}
            </button>
            {yandexTestResult && (
              <span className={`text-[11px] font-medium ${yandexTestResult.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
                {yandexTestResult.msg}
              </span>
            )}
          </div>

          {/* Дополнительные опции авторизации (раскрывающиеся) */}
          <div className="border-t border-slate-100 pt-2">
            <button
              type="button"
              onClick={() => setShowAdvancedYandex(!showAdvancedYandex)}
              className="text-[11px] text-slate-500 hover:text-slate-700 flex items-center gap-1 font-medium"
            >
              {showAdvancedYandex ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              {showAdvancedYandex ? 'Скрыть дополнительные настройки' : 'Вставка RAW JSON авторизованного ключа'}
            </button>

            {showAdvancedYandex && (
              <div className="space-y-3 mt-3 pt-3 border-t border-slate-100">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    JSON авторизованного ключа (вставка содержимого)
                  </label>
                  <textarea
                    rows={3}
                    value={yandexServiceAccountKeyJson}
                    onChange={(e) => setYandexServiceAccountKeyJson(e.target.value)}
                    placeholder='{"id": "...", "service_account_id": "...", "private_key": "..."}'
                    className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-[11px] font-mono focus:ring-2 focus:ring-red-500 focus:bg-white focus:outline-hidden"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 3. S3 / Yandex Object Storage */}
        {/* 3. Yandex Object Storage (для аудиозаписей SpeechKit) */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4" id="yandex-storage-card">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-amber-50 text-amber-700 rounded-xl">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-xs">Yandex Object Storage</h4>
                <p className="text-[11px] text-slate-500">Временный бакет для длинных аудиозаписей SpeechKit (≥ 1 МБ)</p>
              </div>
            </div>
            <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-full">
              SpeechKit S3
            </span>
          </div>

          <div className="p-3 bg-amber-50/70 border border-amber-200/80 rounded-xl text-[11px] text-amber-900 space-y-1">
            <p className="font-semibold flex items-center gap-1.5">
              <span>🎙️</span> Назначение: только для Yandex SpeechKit
            </p>
            <p className="text-amber-800 leading-relaxed">
              Сервис распознавания речи Yandex требует передачи файлов размером более 1 МБ через бакет Yandex Object Storage (URI вида <code className="bg-amber-100 px-1 rounded">s3://bucket/key</code>). Файл удаляется из бакета автоматически сразу после транскрибации.
            </p>
          </div>

          {/* Bucket Name & Endpoint */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Имя бакета Yandex (bucket_name)*
              </label>
              <input
                type="text"
                value={yandexStorageBucket}
                onChange={(e) => setYandexStorageBucket(e.target.value)}
                placeholder="lik28-speechkit-temp"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:ring-2 focus:ring-amber-500 focus:bg-white focus:outline-hidden"
                id="yandex-storage-bucket-input"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Yandex S3 Endpoint*
              </label>
              <input
                type="text"
                value={yandexStorageEndpoint}
                onChange={(e) => setYandexStorageEndpoint(e.target.value)}
                placeholder="https://storage.yandexcloud.net"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:ring-2 focus:ring-amber-500 focus:bg-white focus:outline-hidden"
                id="yandex-storage-endpoint-input"
              />
            </div>
          </div>

          {/* Access Key ID & Secret Key */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Access Key ID (Yandex)*
              </label>
              <input
                type={showKeys ? 'text' : 'password'}
                value={yandexStorageAccessKey}
                onChange={(e) => setYandexStorageAccessKey(e.target.value)}
                placeholder="YCAJE..."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:ring-2 focus:ring-amber-500 focus:bg-white focus:outline-hidden"
                id="yandex-storage-access-key-input"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Secret Key (Yandex)*
              </label>
              <input
                type={showKeys ? 'text' : 'password'}
                value={yandexStorageSecretKey}
                onChange={(e) => setYandexStorageSecretKey(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:ring-2 focus:ring-amber-500 focus:bg-white focus:outline-hidden"
                id="yandex-storage-secret-key-input"
              />
            </div>
          </div>

          {/* Region */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Регион Yandex Storage
            </label>
            <input
              type="text"
              value={yandexStorageRegion}
              onChange={(e) => setYandexStorageRegion(e.target.value)}
              placeholder="ru-central1"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:ring-2 focus:ring-amber-500 focus:bg-white focus:outline-hidden"
              id="yandex-storage-region-input"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleTestYandexStorage}
              disabled={testingYandexStorage}
              className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5"
              id="test-yandex-storage-btn"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${testingYandexStorage ? 'animate-spin text-amber-600' : ''}`} />
              {testingYandexStorage ? 'Проверка...' : 'Проверить бакет Yandex Storage'}
            </button>
            {yandexStorageTestResult && (
              <span className={`text-[11px] font-medium ${yandexStorageTestResult.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
                {yandexStorageTestResult.msg}
              </span>
            )}
          </div>
        </div>

        {/* 4. S3 Timeweb Cloud (для резервной копии базы данных 152-ФЗ) */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4" id="timeweb-s3-card">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-cyan-50 text-cyan-700 rounded-xl">
                <Cloud className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-xs">S3 Timeweb Cloud (Резервное хранилище 152-ФЗ)</h4>
                <p className="text-[11px] text-slate-500">Автономное хранение зашифрованных копий БД (data-store.enc)</p>
              </div>
            </div>
            <span className="text-[10px] bg-cyan-100 text-cyan-800 font-bold px-2 py-0.5 rounded-full">
              Бэкапы БД 152-ФЗ
            </span>
          </div>

          <div className="p-3 bg-cyan-50/70 border border-cyan-200/80 rounded-xl text-[11px] text-cyan-900 space-y-1">
            <p className="font-semibold flex items-center gap-1.5">
              <span>🛡️</span> Назначение: изолированное резервное копирование БД
            </p>
            <p className="text-cyan-800 leading-relaxed">
              Используется отдельно от Yandex Storage исключительно для безопасного создания и хранения резервных копий базы данных (зашифрованных по стандарту AES-256-GCM ключом STORE_ENCRYPTION_KEY).
            </p>
          </div>

          {/* Quick preset */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-slate-600">Пресет:</span>
            <button
              type="button"
              onClick={applyTimewebStoragePreset}
              className="px-2.5 py-1 text-[11px] font-bold rounded-lg border bg-cyan-600 text-white border-cyan-600 shadow-2xs transition-all hover:bg-cyan-700"
            >
              ★ Timeweb Cloud S3
            </button>
          </div>

          {/* Bucket Name & Endpoint */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Имя бакета Timeweb (bucket_name)*
              </label>
              <input
                type="text"
                value={s3BucketName}
                onChange={(e) => setS3BucketName(e.target.value)}
                placeholder="my-db-backups"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:ring-2 focus:ring-cyan-500 focus:bg-white focus:outline-hidden"
                id="timeweb-s3-bucket-name-input"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Timeweb S3 Endpoint*
              </label>
              <input
                type="text"
                value={s3Endpoint}
                onChange={(e) => setS3Endpoint(e.target.value)}
                placeholder="https://s3.timeweb.cloud"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:ring-2 focus:ring-cyan-500 focus:bg-white focus:outline-hidden"
                id="timeweb-s3-endpoint-input"
              />
            </div>
          </div>

          {/* Access Key ID & Secret Key */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Access Key ID (Timeweb)*
              </label>
              <input
                type={showKeys ? 'text' : 'password'}
                value={s3AccessKey}
                onChange={(e) => setS3AccessKey(e.target.value)}
                placeholder="tw-s3-key-..."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:ring-2 focus:ring-cyan-500 focus:bg-white focus:outline-hidden"
                id="timeweb-s3-access-key-input"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Secret Key (Timeweb)*
              </label>
              <input
                type={showKeys ? 'text' : 'password'}
                value={s3SecretKey}
                onChange={(e) => setS3SecretKey(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:ring-2 focus:ring-cyan-500 focus:bg-white focus:outline-hidden"
                id="timeweb-s3-secret-key-input"
              />
            </div>
          </div>

          {/* Region & Key Prefix */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Регион S3
              </label>
              <input
                type="text"
                value={s3Region}
                onChange={(e) => setS3Region(e.target.value)}
                placeholder="ru-1"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:ring-2 focus:ring-cyan-500 focus:bg-white focus:outline-hidden"
                id="timeweb-s3-region-input"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Префикс путей (Key Prefix)
              </label>
              <input
                type="text"
                value={s3KeyPrefix}
                onChange={(e) => setS3KeyPrefix(e.target.value)}
                placeholder="lik28/data/"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:ring-2 focus:ring-cyan-500 focus:bg-white focus:outline-hidden"
                id="timeweb-s3-prefix-input"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleTestS3}
              disabled={testingS3}
              className="px-3 py-1.5 bg-cyan-50 hover:bg-cyan-100 text-cyan-800 border border-cyan-200 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5"
              id="test-s3-connection-btn"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${testingS3 ? 'animate-spin text-cyan-600' : ''}`} />
              {testingS3 ? 'Тестирование...' : 'Проверить бакет Timeweb S3'}
            </button>
            {s3TestResult && (
              <span className={`text-[11px] font-medium ${s3TestResult.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
                {s3TestResult.msg}
              </span>
            )}
          </div>

          {/* S3 Sync Status Component */}
          <S3SyncPanel />
        </div>

        {/* 152-ФЗ Шифрование: STORE_ENCRYPTION_KEY */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4 lg:col-span-2" id="encryption-key-card">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-indigo-50 text-indigo-700 rounded-xl">
                <Shield className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-xs">152-ФЗ Безопасность и шифрование данных (STORE_ENCRYPTION_KEY)</h4>
                <p className="text-[11px] text-slate-500">Симметричное шифрование AES-256-GCM для базы данных и записей</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {storeEncryptionKeyConfigured || storeEncryptionKey.length >= 32 ? (
                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                  AES-256-GCM Активен
                </span>
              ) : (
                <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 text-amber-600" />
                  Резервный ключ сервера
                </span>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-indigo-600" />
                  Ключ шифрования базы данных (STORE_ENCRYPTION_KEY)*
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowStoreEncryptionKey(!showStoreEncryptionKey)}
                    className="text-[11px] text-slate-500 hover:text-slate-800 flex items-center gap-1"
                  >
                    {showStoreEncryptionKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {showStoreEncryptionKey ? 'Скрыть' : 'Показать'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyEncryptionKey}
                    disabled={!storeEncryptionKey}
                    className="text-[11px] text-indigo-600 hover:text-indigo-800 flex items-center gap-1 disabled:opacity-40"
                  >
                    {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedKey ? 'Скопировано!' : 'Копировать'}
                  </button>
                </div>
              </div>

              <div className="relative">
                <input
                  type={showStoreEncryptionKey ? 'text' : 'password'}
                  value={storeEncryptionKey}
                  onChange={(e) => setStoreEncryptionKey(e.target.value)}
                  placeholder="64-значный шестнадцатеричный ключ (например: 7f3b8c...)"
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono focus:ring-2 focus:ring-indigo-500 focus:bg-white focus:outline-hidden tracking-wider"
                  id="store-encryption-key-input"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
                <p className="text-[11px] text-slate-500">
                  Требуется 256-битный ключ (64 шестнадцатеричных символа или строка длиной от 32 байт).
                </p>
                <button
                  type="button"
                  onClick={handleGenerateEncryptionKey}
                  className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5"
                  id="generate-encryption-key-btn"
                >
                  <Zap className="w-3.5 h-3.5 text-indigo-600" />
                  Сгенерировать безопасный 256-битный ключ
                </button>
              </div>
            </div>

            <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-[11px] text-slate-600 leading-relaxed">
              <span className="font-bold text-slate-800">🔒 Требования 152-ФЗ «О персональных данных»:</span> Все данные клиентов салона красоты «Лик 28», телефонные номера, записи разговоров и аудиофайлы хранятся в зашифрованном виде. При переносе файла <code className="font-mono bg-white px-1 py-0.5 rounded border border-slate-200">data-store.enc</code> на другой сервер необходимо указать идентичный <code className="font-mono bg-white px-1 py-0.5 rounded border border-slate-200">STORE_ENCRYPTION_KEY</code>.
            </div>
          </div>
        </div>

        {/* 4. ВАТС Мегафон */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-green-50 text-green-700 rounded-xl">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-xs">ВАТС Мегафон</h4>
                <p className="text-[11px] text-slate-500">Автоматический импорт аудиозаписей звонков</p>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={megafonPollingEnabled}
                onChange={(e) => setMegafonPollingEnabled(e.target.checked)}
                className="rounded-sm text-emerald-600 focus:ring-emerald-500 w-4 h-4"
              />
              Автоопрос
            </label>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Токен авторизации вебхуков Мегафон (MEGAFON_TOKEN)
            </label>
            <input
              type={showKeys ? 'text' : 'password'}
              value={megafonToken}
              onChange={(e) => setMegafonToken(e.target.value)}
              placeholder="Токен из раздела интеграции АТС Мегафон"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono"
            />
          </div>

          {/* Настройка автоопроса АТС и регулировка интервала */}
          <div className="p-3.5 bg-emerald-50/70 rounded-xl border border-emerald-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={megafonPollingEnabled}
                  onChange={(e) => setMegafonPollingEnabled(e.target.checked)}
                  className="rounded-sm text-emerald-600 focus:ring-emerald-500 w-4 h-4"
                  id="megafon-auto-poll-checkbox"
                />
                <span>Автоматический опрос АТС Мегафон</span>
              </label>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                megafonPollingEnabled ? 'bg-emerald-200 text-emerald-800' : 'bg-slate-200 text-slate-600'
              }`}>
                {megafonPollingEnabled ? 'Включен' : 'Выключен'}
              </span>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-emerald-600" />
                  Интервал автоопроса АТС:
                </label>
                <span className="text-xs font-bold text-emerald-700 font-mono">
                  {megafonPollingIntervalMinutes} мин.
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min="1"
                    max="1440"
                    value={megafonPollingIntervalMinutes}
                    onChange={(e) => setMegafonPollingIntervalMinutes(Math.max(1, parseInt(e.target.value, 10) || 15))}
                    className="w-20 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-800 focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                    id="megafon-polling-interval-input"
                  />
                  <span className="text-xs text-slate-500 font-medium">мин.</span>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {[5, 10, 15, 30, 60].map((mins) => (
                    <button
                      key={mins}
                      type="button"
                      onClick={() => setMegafonPollingIntervalMinutes(mins)}
                      className={`px-2.5 py-1 text-[11px] rounded-lg font-semibold transition-all ${
                        megafonPollingIntervalMinutes === mins
                          ? 'bg-emerald-600 text-white shadow-3xs'
                          : 'bg-white hover:bg-emerald-100 text-slate-700 border border-slate-200'
                      }`}
                    >
                      {mins} мин{mins === 15 ? ' (рек.)' : ''}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-[10px] text-slate-500 mt-1.5 leading-relaxed">
                Сервер автоматически обращается к API АТС Мегафон каждые {megafonPollingIntervalMinutes} мин. и загружает новые поступившие звонки.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Логин ЛК Мегафон</label>
              <input
                type="text"
                value={megafonLkLogin}
                onChange={(e) => setMegafonLkLogin(e.target.value)}
                placeholder="+79..."
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Пароль ЛК Мегафон</label>
              <input
                type={showKeys ? 'text' : 'password'}
                value={megafonLkPassword}
                onChange={(e) => setMegafonLkPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs"
              />
            </div>
          </div>

          {/* Ручной опрос за период */}
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
            <span className="text-[11px] font-bold text-slate-700 block">
              Импорт звонков Мегафон за диапазон дат:
            </span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-[10px] text-slate-500">С:</span>
                <input
                  type="datetime-local"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full p-1.5 bg-white border border-slate-300 rounded-lg text-[11px]"
                />
              </div>
              <div>
                <span className="text-[10px] text-slate-500">По:</span>
                <input
                  type="datetime-local"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full p-1.5 bg-white border border-slate-300 rounded-lg text-[11px]"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={handleManualPeriodSync}
              disabled={syncingPeriod}
              className="w-full py-1.5 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 transition-colors flex items-center justify-center gap-1.5"
            >
              <Calendar className="w-3.5 h-3.5" />
              {syncingPeriod ? 'Загрузка звонков...' : 'Запустить импорт за период'}
            </button>
            {syncPeriodResult && (
              <p className="text-[11px] text-center font-medium text-emerald-700">{syncPeriodResult}</p>
            )}
          </div>
        </div>

        {/* 5. ВКонтакте (VK API) */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-blue-50 text-blue-700 rounded-xl">
                <MessageCircle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-xs">ВКонтакте (Уведомления управляющих)</h4>
                <p className="text-[11px] text-slate-500">Оповещение о конфликтах и низких оценках</p>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={vkEnabled}
                onChange={(e) => setVkEnabled(e.target.checked)}
                className="rounded-sm text-blue-600 focus:ring-blue-500 w-4 h-4"
              />
              Включено
            </label>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Токен сообщества VK (VK_TOKEN)</label>
            <input
              type={showKeys ? 'text' : 'password'}
              value={vkToken}
              onChange={(e) => setVkToken(e.target.value)}
              placeholder="vk1.a.w..."
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">ID чата или диалога (VK_CHAT_ID)</label>
            <input
              type="text"
              value={vkChatId}
              onChange={(e) => setVkChatId(e.target.value)}
              placeholder="2000000045 или ID пользователя"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Шаблон сообщения</label>
            <textarea
              rows={2}
              value={vkTemplate}
              onChange={(e) => setVkTemplate(e.target.value)}
              className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-[11px] font-mono"
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleTestVk}
              disabled={testingVk}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5"
            >
              <MessageCircle className="w-3.5 h-3.5 text-blue-600" />
              {testingVk ? 'Отправка...' : 'Отправить тестовое сообщение'}
            </button>
            {vkTestResult && (
              <span className={`text-[11px] font-medium ${vkTestResult.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
                {vkTestResult.msg}
              </span>
            )}
          </div>
        </div>

        {/* 6. YClients & 152-ФЗ TTL */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-indigo-50 text-indigo-700 rounded-xl">
                <Calendar className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-bold text-slate-900 text-xs">YClients & Политика очистки 152-ФЗ</h4>
                <p className="text-[11px] text-slate-500">Автоматическое удаление записей по истечении TTL</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">ID салона «Лик 28»</label>
              <input
                type="text"
                value={yclientsSalonId}
                onChange={(e) => setYclientsSalonId(e.target.value)}
                placeholder="например, 987654"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Токен пользователя YClients</label>
              <input
                type={showKeys ? 'text' : 'password'}
                value={yclientsUserToken}
                onChange={(e) => setYclientsUserToken(e.target.value)}
                placeholder="User Token"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono"
              />
            </div>
          </div>

          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-2">
            <span className="text-[11px] font-bold text-slate-800 flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-emerald-600" />
              Сроки хранения персональных данных (152-ФЗ):
            </span>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <span className="text-[10px] text-slate-500">Аудио (дни):</span>
                <input
                  type="number"
                  min={1}
                  value={ttlAudioDays}
                  onChange={(e) => setTtlAudioDays(parseInt(e.target.value, 10) || 14)}
                  className="w-full p-1.5 bg-white border border-slate-300 rounded-lg text-xs"
                />
              </div>
              <div>
                <span className="text-[10px] text-slate-500">Транскрипт:</span>
                <input
                  type="number"
                  min={1}
                  value={ttlTranscriptDays}
                  onChange={(e) => setTtlTranscriptDays(parseInt(e.target.value, 10) || 30)}
                  className="w-full p-1.5 bg-white border border-slate-300 rounded-lg text-xs"
                />
              </div>
              <div>
                <span className="text-[10px] text-slate-500">Полный отчет:</span>
                <input
                  type="number"
                  min={1}
                  value={ttlFullDeleteDays}
                  onChange={(e) => setTtlFullDeleteDays(parseInt(e.target.value, 10) || 90)}
                  className="w-full p-1.5 bg-white border border-slate-300 rounded-lg text-xs"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={handleRunCleanupNow}
              disabled={runningCleanup}
              className="w-full py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-bold transition-colors flex items-center justify-center gap-1.5 mt-2"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {runningCleanup ? 'Выполняется очистка...' : 'Запустить очистку ПДн прямо сейчас'}
            </button>
            {cleanupResult && (
              <p className="text-[10px] text-emerald-700 font-medium text-center">
                Удалено: аудио {cleanupResult.audioDeleted ?? 0}, стенограмм {cleanupResult.transcriptsPurged ?? 0}
              </p>
            )}
          </div>
        </div>

      </div>

      {/* Sticky Bottom Save Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex justify-between items-center sticky bottom-3">
        <span className="text-xs text-slate-500">
          Изменения вступают в силу немедленно после сохранения
        </span>
        <button
          type="submit"
          disabled={saving}
          className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center gap-2"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Сохранение...' : 'Сохранить все изменения'}
        </button>
      </div>
    </form>
  );
}
