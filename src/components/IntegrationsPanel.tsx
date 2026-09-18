/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Settings, Save, Server, Shield, MessageCircle, Database, 
  HelpCircle, Calendar, RefreshCw, Clock, Globe, Zap, 
  Key, Lock, CheckCircle2, AlertTriangle, Trash2, Cpu
} from 'lucide-react';
import { SystemConfig, GigaChatModel } from '../types.js';
import { S3SyncPanel } from './S3SyncPanel.js';

interface IntegrationsPanelProps {
  config: SystemConfig;
  onSaveConfig: (newConfig: SystemConfig) => Promise<void>;
  userRole?: string;
}

export function IntegrationsPanel({ config, onSaveConfig, userRole = 'admin' }: IntegrationsPanelProps) {
  const [defaultModel, setDefaultModel] = useState<GigaChatModel>(
    config.default_gigachat_model || (config.activeModel as GigaChatModel) || 'GigaChat:Lite'
  );

  const [megafonToken, setMegafonToken] = useState(config.megafon?.token || '');
  const [megafonActive, setMegafonActive] = useState(config.megafon?.active ?? true);
  const [pollingEnabled, setPollingEnabled] = useState(config.megafon?.pollingEnabled ?? false);
  const [pollingIntervalMinutes, setPollingIntervalMinutes] = useState(config.megafon?.pollingIntervalMinutes || 5);
  const [megafonLkLogin, setMegafonLkLogin] = useState(config.megafon?.lkLogin || '');
  const [megafonLkPassword, setMegafonLkPassword] = useState(config.megafon?.lkPassword || '');

  // Manual Period Sync
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

  // Immediate Polling Trigger
  const [pollingNow, setPollingNow] = useState(false);
  const [pollNowResult, setPollNowResult] = useState<string | null>(null);

  // TTL Manual Trigger
  const [runningCleanup, setRunningCleanup] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<any | null>(null);

  // GigaChat Queue & Test Status
  const [queueStatus, setQueueStatus] = useState<{ pending: number; isProcessing: boolean; totalProcessed: number } | null>(null);
  const [testingGiga, setTestingGiga] = useState(false);
  const [gigaTestResult, setGigaTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const fetchQueueStatus = async () => {
    try {
      const res = await fetch('/api/gigachat/queue');
      if (res.ok) {
        const data = await res.json();
        setQueueStatus(data.queue);
      }
    } catch {}
  };

  useEffect(() => {
    fetchQueueStatus();
    const interval = setInterval(fetchQueueStatus, 4000);
    return () => clearInterval(interval);
  }, []);

  const handleTestGigaChat = async () => {
    setTestingGiga(true);
    setGigaTestResult(null);
    try {
      const res = await fetch('/api/gigachat/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: defaultModel })
      });
      const data = await res.json();
      if (data.success) {
        setGigaTestResult({ ok: true, msg: data.message || 'Тест успешен!' });
      } else {
        setGigaTestResult({ ok: false, msg: data.error || 'Ошибка подключения' });
      }
      fetchQueueStatus();
    } catch (err: any) {
      setGigaTestResult({ ok: false, msg: err.message || 'Сбой сети' });
    } finally {
      setTestingGiga(false);
    }
  };

  const [vkEnabled, setVkEnabled] = useState(config.vk?.enabled ?? true);
  const [vkToken, setVkToken] = useState(config.vk?.token || '');
  const [vkChatId, setVkChatId] = useState(config.vk?.chatId || '');
  const [vkTemplate, setVkTemplate] = useState(config.vk?.template || '');
  
  const [ycEnabled, setYcEnabled] = useState(config.yclients?.enabled ?? true);
  const [ycUserToken, setYcUserToken] = useState(config.yclients?.userToken || '');
  const [ycPartnerToken, setYcPartnerToken] = useState(config.yclients?.partnerToken || '');
  const [ycSalonId, setYcSalonId] = useState(config.yclients?.salonId || '');

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Synchronize component state whenever config prop changes
  useEffect(() => {
    if (config) {
      if (config.default_gigachat_model) setDefaultModel(config.default_gigachat_model);
      setMegafonToken(config.megafon?.token || '');
      setMegafonActive(config.megafon?.active ?? true);
      setPollingEnabled(config.megafon?.pollingEnabled ?? false);
      setPollingIntervalMinutes(config.megafon?.pollingIntervalMinutes || 5);
      setMegafonLkLogin(config.megafon?.lkLogin || '');
      setMegafonLkPassword(config.megafon?.lkPassword || '');

      setVkEnabled(config.vk?.enabled ?? true);
      setVkToken(config.vk?.token || '');
      setVkChatId(config.vk?.chatId || '');
      setVkTemplate(config.vk?.template || '');

      setYcEnabled(config.yclients?.enabled ?? true);
      setYcUserToken(config.yclients?.userToken || '');
      setYcPartnerToken(config.yclients?.partnerToken || '');
      setYcSalonId(config.yclients?.salonId || '');
    }
  }, [config]);

  const handleImmediatePoll = async () => {
    setPollingNow(true);
    setPollNowResult(null);
    try {
      const res = await fetch('/api/calls/fetch-poll', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setPollNowResult(`Опрос выполнен! Найдено звонков: ${data.imported}`);
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setPollNowResult('Ошибка опроса АТС');
      }
    } catch (err: any) {
      setPollNowResult(`Ошибка: ${err.message || err}`);
    } finally {
      setPollingNow(false);
    }
  };

  const handlePeriodSync = async () => {
    setSyncingPeriod(true);
    setSyncPeriodResult(null);
    try {
      const res = await fetch('/api/calls/fetch-period', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: fromDate, to: toDate })
      });
      const data = await res.json();
      if (data.success) {
        setSyncPeriodResult(data.message);
        setTimeout(() => window.location.reload(), 2000);
      } else {
        setSyncPeriodResult(`Ошибка: ${data.error || 'Неизвестная ошибка'}`);
      }
    } catch (err: any) {
      setSyncPeriodResult(`Ошибка соединения: ${err.message || err}`);
    } finally {
      setSyncingPeriod(false);
    }
  };

  const handleRunCleanup = async () => {
    setRunningCleanup(true);
    setCleanupResult(null);
    try {
      const res = await fetch('/api/cleanup/run', {
        method: 'POST',
        headers: { 'x-user-role': userRole },
      });
      const data = await res.json();
      setCleanupResult(data.stats || data);
    } catch (err: any) {
      setCleanupResult({ error: err.message || 'Ошибка запуска' });
    } finally {
      setRunningCleanup(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updatedConfig: SystemConfig = {
        ...config,
        activeModel: defaultModel,
        default_gigachat_model: defaultModel,
        megafon: {
          ...config.megafon,
          token: megafonToken,
          active: megafonActive,
          pollingEnabled,
          pollingIntervalMinutes: Number(pollingIntervalMinutes),
          lkLogin: megafonLkLogin,
          lkPassword: megafonLkPassword,
        },
        vk: {
          ...config.vk,
          enabled: vkEnabled,
          token: vkToken,
          chatId: vkChatId,
          template: vkTemplate,
        },
        yclients: {
          ...config.yclients,
          enabled: ycEnabled,
          userToken: ycUserToken,
          partnerToken: ycPartnerToken,
          salonId: ycSalonId,
        },
      };

      await onSaveConfig(updatedConfig);

      // Also update /api/settings
      await fetch('/api/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': userRole,
        },
        body: JSON.stringify({ default_gigachat_model: defaultModel }),
      });

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('Failed to save config:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex justify-between items-center bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Settings className="w-5 h-5 text-indigo-600" />
            Интеграции и соответствие 152-ФЗ
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Конфигурация Yandex Cloud, GigaChat, шифрования AES-256-GCM, АТС Мегафон, VK и YClients
          </p>
        </div>

        <button
          onClick={handleSave}
          disabled={saving || userRole !== 'admin'}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg shadow-xs transition-all disabled:opacity-50"
        >
          <Save className="w-4 h-4" />
          {saving ? 'Сохранение...' : saved ? 'Сохранено!' : 'Сохранить настройки'}
        </button>
      </div>

      {userRole !== 'admin' && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
          <span>Вы вошли с ролью <b>{userRole}</b>. Изменение глобальных настроек и выбор модели GigaChat доступны только администраторам.</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. GigaChat (Сбер) */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-xs">
                GC
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">GigaChat (Сбер)</h3>
                <p className="text-xs text-slate-500">Анализ звонков для салона «Лик 28»</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
              <CheckCircle2 className="w-3.5 h-3.5" /> РФ провайдер
            </span>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Базовая модель по умолчанию
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['GigaChat:Lite', 'GigaChat:Pro', 'GigaChat:Max'] as GigaChatModel[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    disabled={userRole !== 'admin'}
                    onClick={() => setDefaultModel(m)}
                    className={`py-2 px-3 text-xs font-medium rounded-lg border text-center transition-all ${
                      defaultModel === m
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    {m.replace('GigaChat:', '')}
                    <span className="block text-[10px] opacity-75 mt-0.5">
                      {m === 'GigaChat:Lite' ? 'Базовая' : m === 'GigaChat:Pro' ? 'Сложные диалоги' : 'Флагман'}
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                * Любой звонок можно повторно проанализировать другой моделью индивидуально в карточке звонка.
              </p>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1.5 text-slate-600">
              <div className="flex justify-between items-center">
                <span>Очередь запросов (FIFO):</span>
                <span className="font-semibold inline-flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${queueStatus?.isProcessing ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`}></span>
                  {queueStatus?.isProcessing ? 'Выполняется (активен 1)' : 'Ожидание (0 активных)'}
                  {queueStatus && queueStatus.pending > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-mono">
                      +{queueStatus.pending} в очереди
                    </span>
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Ограничение параллелизма:</span>
                <span className="font-mono text-emerald-700 font-semibold">1 запрос одновременно (concurrency: 1)</span>
              </div>
              <div className="flex justify-between">
                <span>Защита от 429 (Rate Limit):</span>
                <span className="font-mono text-slate-700">Экспоненциальный retry (2с, 4с, 8с, 16с) + Retry-After</span>
              </div>
              <div className="flex justify-between">
                <span>Всего обработано очередью:</span>
                <span className="font-mono font-semibold text-slate-800">{queueStatus?.totalProcessed ?? 0}</span>
              </div>
            </div>

            {/* GigaChat connection & queue test */}
            <div className="pt-1">
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleTestGigaChat}
                  disabled={testingGiga}
                  className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-700 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${testingGiga ? 'animate-spin' : ''}`} />
                  {testingGiga ? 'Проверка очереди...' : 'Проверить соединение и очередь'}
                </button>
                <span className="text-[11px] text-slate-400">
                  {queueStatus?.pending ? `В очереди: ${queueStatus.pending}` : 'Очередь пуста'}
                </span>
              </div>
              {gigaTestResult && (
                <div className={`mt-2 p-2 rounded text-xs border ${gigaTestResult.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                  {gigaTestResult.msg}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 2. Yandex Cloud (SpeechKit + Object Storage) */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center font-bold text-xs">
                YC
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800">Yandex SpeechKit</h3>
                <p className="text-xs text-slate-500">Распознавание речи с разделением по ролям</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200">
              <Lock className="w-3.5 h-3.5" /> Сервисный аккаунт
            </span>
          </div>

          <div className="mt-4 space-y-3 text-xs text-slate-600">
            <div className="p-3 bg-purple-50/50 rounded-lg border border-purple-100 space-y-1.5">
              <div className="flex items-center gap-2 font-medium text-purple-900">
                <Key className="w-4 h-4 text-purple-600" />
                Авторизованный ключ (JSON):
              </div>
              <p className="font-mono text-[11px] text-purple-800 bg-white/70 p-1.5 rounded border border-purple-200">
                /app/keys/authorized_key.json (chmod 600)
              </p>
              <p className="text-[11px] text-purple-700">
                Безопасно монтируется через Docker Volume в режиме чтения (:ro). Никогда не попадает в образ.
              </p>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1">
              <div className="flex justify-between">
                <span>Стриминг / Буфер &lt; 1МБ:</span>
                <span className="font-semibold text-slate-700">Прямая передача Base64</span>
              </div>
              <div className="flex justify-between">
                <span>Аудио &ge; 1МБ:</span>
                <span className="font-semibold text-slate-700">Yandex Object Storage</span>
              </div>
              <div className="flex justify-between">
                <span>Очистка бакета:</span>
                <span className="font-semibold text-emerald-600">Немедленное удаление в finally</span>
              </div>
            </div>
          </div>
        </div>

        {/* 3. Защита данных 152-ФЗ и Шифрование */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs lg:col-span-2">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <Shield className="w-5 h-5 text-indigo-600" />
              <div>
                <h3 className="text-sm font-bold text-slate-800">Защита данных (152-ФЗ) &amp; Хранилище AES-256-GCM</h3>
                <p className="text-xs text-slate-500">Шифрование базы звонков, реестр согласий и регламент автоудаления (TTL)</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Шифрование активно
            </span>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-xs font-semibold text-slate-700 mb-1">Файлы данных:</div>
              <div className="space-y-1 font-mono text-[11px] text-slate-600">
                <div>• /app/data/data-store.enc</div>
                <div>• /app/data/consents.enc</div>
              </div>
              <p className="text-[10px] text-slate-400 mt-2">
                При прямом открытии файлы зашифрованы ключом STORE_ENCRYPTION_KEY.
              </p>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-xs font-semibold text-slate-700 mb-1">Регламент TTL очистки:</div>
              <ul className="text-[11px] text-slate-600 space-y-1">
                <li>• <b>30 дней:</b> удаление ссылок на аудио</li>
                <li>• <b>90 дней:</b> удаление расшифровок и анализа</li>
                <li>• <b>3 года:</b> полное удаление звонка</li>
                <li>• <b>90 дней:</b> журнал доступа к ПДн</li>
              </ul>
            </div>

            <div className="p-3.5 bg-indigo-50/50 rounded-lg border border-indigo-100 flex flex-col justify-between">
              <div>
                <div className="text-xs font-semibold text-indigo-900 mb-1">Внеплановая TTL-очистка:</div>
                <p className="text-[11px] text-indigo-700">
                  Автоматический запуск происходит ежедневно в 03:00 ночи через node-cron.
                </p>
              </div>

              <div className="mt-3">
                <button
                  type="button"
                  onClick={handleRunCleanup}
                  disabled={runningCleanup || userRole !== 'admin'}
                  className="w-full flex items-center justify-center gap-1.5 py-2 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded text-xs font-medium transition-all shadow-xs disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${runningCleanup ? 'animate-spin' : ''}`} />
                  {runningCleanup ? 'Выполняется...' : 'Запустить очистку сейчас'}
                </button>
              </div>
            </div>
          </div>

          {cleanupResult && (
            <div className="mt-3 p-3 bg-slate-100 rounded-lg text-xs font-mono text-slate-700 border border-slate-200">
              Результат очистки: {JSON.stringify(cleanupResult)}
            </div>
          )}
        </div>

        {/* 4. Мегафон ВАТС */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              <Server className="w-5 h-5 text-green-600" />
              <div>
                <h3 className="text-sm font-bold text-slate-800">АТС Мегафон ВАТС</h3>
                <p className="text-xs text-slate-500">Автоинформатор и интеграция звонков</p>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={megafonActive}
                onChange={(e) => setMegafonActive(e.target.checked)}
                className="w-4 h-4 rounded text-green-600"
              />
              <span className="text-xs font-medium text-slate-700">Активна</span>
            </label>
          </div>

          <div className="mt-4 space-y-3 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Токен авторизации ВАТС:</label>
              <input
                type="password"
                value={megafonToken}
                onChange={(e) => setMegafonToken(e.target.value)}
                placeholder="Токен АТС Мегафон"
                className="w-full p-2 border border-slate-200 rounded-lg text-xs font-mono"
              />
            </div>

            <div className="p-3 bg-green-50 rounded-lg border border-green-200 text-green-900">
              <p className="font-semibold mb-1">Уведомление о записи (152-ФЗ):</p>
              <p className="text-[11px] text-green-800">
                Автоинформатор воспроизводится АТС Мегафон перед соединением с оператором. Ответ на вызов подтверждает голосовое согласие.
              </p>
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
              <button
                type="button"
                onClick={handleImmediatePoll}
                disabled={pollingNow}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition-all"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${pollingNow ? 'animate-spin' : ''}`} />
                {pollingNow ? 'Опрос...' : 'Опросить АТС сейчас'}
              </button>
              {pollNowResult && <span className="text-[11px] text-slate-600 font-medium">{pollNowResult}</span>}
            </div>
          </div>
        </div>

        {/* 5. ВКонтакте и Yclients */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-5">
          {/* VK */}
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-5 h-5 text-sky-600" />
                <h3 className="text-sm font-bold text-slate-800">ВКонтакте (Обезличенные отчеты)</h3>
              </div>
              <input
                type="checkbox"
                checked={vkEnabled}
                onChange={(e) => setVkEnabled(e.target.checked)}
                className="w-4 h-4 rounded text-sky-600"
              />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-slate-600 mb-1">ID чата управляющего:</label>
                <input
                  type="text"
                  value={vkChatId}
                  onChange={(e) => setVkChatId(e.target.value)}
                  placeholder="2000000045"
                  className="w-full p-2 border border-slate-200 rounded-lg text-xs"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-600 mb-1">Статус 152-ФЗ:</label>
                <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600">
                  Только маска <b>Клиент (****1234)</b>
                </div>
              </div>
            </div>
          </div>

          {/* YClients */}
          <div className="pt-3 border-t border-slate-100">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-amber-600" />
                <h3 className="text-sm font-bold text-slate-800">Yclients (CRM салона)</h3>
              </div>
              <input
                type="checkbox"
                checked={ycEnabled}
                onChange={(e) => setYcEnabled(e.target.checked)}
                className="w-4 h-4 rounded text-amber-600"
              />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-medium text-slate-600 mb-1">ID салона:</label>
                <input
                  type="text"
                  value={ycSalonId}
                  onChange={(e) => setYcSalonId(e.target.value)}
                  placeholder="987654"
                  className="w-full p-2 border border-slate-200 rounded-lg text-xs"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-600 mb-1">Статус 152-ФЗ:</label>
                <div className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600">
                  Без транскрипта и персональных данных
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 6. Хранилище S3 timeweb.cloud */}
        <div className="lg:col-span-2">
          <S3SyncPanel />
        </div>
      </div>
    </div>
  );
}
