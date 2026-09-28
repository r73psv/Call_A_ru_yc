/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Trash2, ShieldCheck, Clock, FileText, HardDrive, 
  RefreshCw, CheckCircle2, AlertTriangle, Play, Sparkles,
  Info, Database, Layers
} from 'lucide-react';
import { AutoCleanupSettings } from '../../types.js';

interface AutoCleanupSettingsCardProps {
  authToken?: string | null;
}

interface CurrentStorageStats {
  logsTotal: number;
  logsOlderThanRetention: number;
  accessLogsTotal: number;
  tempFilesTotal: number;
  tempFilesBytes: number;
  tempFilesOlderThanRetention: number;
  tempBytesOlderThanRetention: number;
  scannedDirs: string[];
}

export function AutoCleanupSettingsCard({ authToken }: AutoCleanupSettingsCardProps) {
  const [settings, setSettings] = useState<AutoCleanupSettings>({
    enabled: true,
    logRetentionDays: 30,
    tempFilesRetentionDays: 30,
    autoRunDaily: true
  });
  const [currentStats, setCurrentStats] = useState<CurrentStorageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningCleanup, setRunningCleanup] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [lastCleanupStats, setLastCleanupStats] = useState<any>(null);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const headers: Record<string, string> = { 'x-user-role': 'admin' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const res = await fetch('/api/admin/cleanup-settings', { headers });
      if (res.ok) {
        const data = await res.json();
        if (data.settings) {
          setSettings(data.settings);
          if (data.settings.lastRunStats) {
            setLastCleanupStats(data.settings.lastRunStats);
          }
        }
        if (data.currentStats) {
          setCurrentStats(data.currentStats);
        }
      }
    } catch (err: any) {
      console.error('Failed to load cleanup settings:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, [authToken]);

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const headers: Record<string, string> = { 
        'x-user-role': 'admin',
        'Content-Type': 'application/json'
      };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const res = await fetch('/api/admin/cleanup-settings', {
        method: 'POST',
        headers,
        body: JSON.stringify(settings)
      });
      const data = await res.json();
      if (res.ok) {
        setFeedback({ type: 'success', message: 'Настройки автоочистки по 152-ФЗ успешно сохранены' });
        await fetchSettings();
      } else {
        setFeedback({ type: 'error', message: data.error || 'Ошибка при сохранении' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Сетевая ошибка' });
    } finally {
      setSaving(false);
    }
  };

  const handleRunCleanupNow = async () => {
    if (!confirm('Выполнить регламентную очистку логов и временных файлов старше 30 дней прямо сейчас?')) {
      return;
    }
    setRunningCleanup(true);
    setFeedback(null);
    try {
      const headers: Record<string, string> = { 'x-user-role': 'admin' };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

      const res = await fetch('/api/admin/cleanup/run', { method: 'POST', headers });
      const data = await res.json();
      if (res.ok && data.stats) {
        setLastCleanupStats(data.stats);
        setFeedback({
          type: 'success',
          message: `Очистка успешно завершена: удалено ${data.stats.logsCleaned} логов, ${data.stats.tempFilesCleaned} временных файлов (${formatBytes(data.stats.tempBytesCleaned || 0)}), ${data.stats.audioRemoved} аудиозаписей.`
        });
        await fetchSettings();
      } else {
        setFeedback({ type: 'error', message: data.error || 'Ошибка при выполнении очистки' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Ошибка запуска процедуры очистки' });
    } finally {
      setRunningCleanup(false);
    }
  };

  function formatBytes(bytes: number): string {
    if (!bytes || bytes === 0) return '0 Б';
    const k = 1024;
    const sizes = ['Б', 'КБ', 'МБ', 'ГБ'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatDate(isoString?: string): string {
    if (!isoString) return 'Не выполнялась';
    try {
      return new Date(isoString).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    } catch {
      return isoString;
    }
  }

  return (
    <div className="space-y-6">
      {/* 152-FZ Legal Regulatory Banner */}
      <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-2xl p-5 text-emerald-100 flex flex-col md:flex-row items-start gap-4">
        <div className="p-3 bg-emerald-500/20 text-emerald-300 rounded-xl shrink-0 border border-emerald-500/30">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-white tracking-tight">
              Регламент автоматической очистки данных (ст. 5 и 21 закона 152-ФЗ)
            </h3>
            <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold px-2 py-0.2 rounded-full">
              Соответствие 152-ФЗ
            </span>
          </div>
          <p className="text-emerald-200/90 leading-relaxed">
            В соответствии с Федеральным законом № 152-ФЗ «О персональных данных», персональные данные субъектов, технические логи обработки, временные аудиофайлы SpeechKit и дампы транскрибации подлежат обязательному уничтожению либо обезличиванию по достижении целей обработки или по истечении установленных регламентных сроков (рекомендованный срок хранения логов и временных файлов — <strong>30 дней</strong>).
          </p>
        </div>
      </div>

      {/* Storage & Retention Live State Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* System Logs State */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between text-slate-200">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <span className="flex items-center gap-1.5 font-medium">
                <FileText className="w-4 h-4 text-blue-400" /> Системные логи
              </span>
              <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">
                {settings.logRetentionDays} дн. лимит
              </span>
            </div>
            <div className="text-2xl font-bold text-white">
              {currentStats ? currentStats.logsTotal : '...'}
              <span className="text-xs font-normal text-slate-400 ml-1.5">записей</span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between">
            <span>Старше {settings.logRetentionDays} дней:</span>
            <span className={`font-bold font-mono ${currentStats && currentStats.logsOlderThanRetention > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {currentStats ? `${currentStats.logsOlderThanRetention} к удалению` : '0'}
            </span>
          </div>
        </div>

        {/* Temporary Files & Audio Cache State */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between text-slate-200">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <span className="flex items-center gap-1.5 font-medium">
                <HardDrive className="w-4 h-4 text-emerald-400" /> Временные файлы и аудио
              </span>
              <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-400 font-mono">
                {settings.tempFilesRetentionDays} дн. лимит
              </span>
            </div>
            <div className="text-2xl font-bold text-white">
              {currentStats ? currentStats.tempFilesTotal : '...'}
              <span className="text-xs font-normal text-slate-400 ml-1.5">
                ({currentStats ? formatBytes(currentStats.tempFilesBytes) : '0 Б'})
              </span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between">
            <span>Старше {settings.tempFilesRetentionDays} дней:</span>
            <span className={`font-bold font-mono ${currentStats && currentStats.tempFilesOlderThanRetention > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {currentStats ? `${currentStats.tempFilesOlderThanRetention} ф. (${formatBytes(currentStats.tempBytesOlderThanRetention)})` : '0'}
            </span>
          </div>
        </div>

        {/* Last Scheduled Cleanup */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between text-slate-200">
          <div>
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <span className="flex items-center gap-1.5 font-medium">
                <Clock className="w-4 h-4 text-amber-400" /> Последняя очистка
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${settings.enabled ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-rose-950 text-rose-400'}`}>
                {settings.enabled ? 'Автоочистка активна' : 'Отключена'}
              </span>
            </div>
            <div className="text-sm font-semibold text-white truncate">
              {formatDate(settings.lastRunTimestamp)}
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between">
            <span>Удалено в прошлый раз:</span>
            <span className="font-mono text-emerald-400">
              {lastCleanupStats ? `${lastCleanupStats.logsCleaned || 0} логов, ${lastCleanupStats.tempFilesCleaned || 0} файлов` : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Configuration Form */}
      <form onSubmit={handleSaveSettings} className="bg-slate-900/95 border border-slate-800 rounded-2xl p-6 space-y-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-amber-400" />
              Параметры регламентного удаления логов и временных файлов
            </h4>
            <p className="text-xs text-slate-400 mt-1">
              Настройте периоды хранения для соблюдения сроков обработки персональных данных салона
            </p>
          </div>

          <button
            type="button"
            onClick={fetchSettings}
            disabled={loading}
            className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Обновить состояние"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Feedback Message */}
        {feedback && (
          <div className={`p-4 rounded-xl text-xs flex items-center gap-2.5 ${
            feedback.type === 'success' 
              ? 'bg-emerald-950/80 border border-emerald-800 text-emerald-200' 
              : 'bg-rose-950/80 border border-rose-800 text-rose-200'
          }`}>
            {feedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />}
            <span>{feedback.message}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Log Retention Setting */}
          <div className="space-y-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
            <div className="flex items-center justify-between">
              <label htmlFor="log-retention-input" className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-blue-400" />
                Срок хранения системных логов и аудита:
              </label>
              <span className="font-bold text-xs text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20 font-mono">
                {settings.logRetentionDays} дней
              </span>
            </div>

            <div className="flex items-center gap-3">
              <input
                id="log-retention-input"
                type="range"
                min="7"
                max="90"
                step="1"
                value={settings.logRetentionDays}
                onChange={(e) => setSettings({ ...settings, logRetentionDays: Number(e.target.value) })}
                className="w-full accent-blue-500 cursor-pointer"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              {[14, 30, 60, 90].map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setSettings({ ...settings, logRetentionDays: days })}
                  className={`text-[11px] px-2.5 py-1 rounded transition-colors ${
                    settings.logRetentionDays === days 
                      ? 'bg-blue-600 text-white font-bold shadow-xs' 
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  {days} дн. {days === 30 && '(152-ФЗ)'}
                </button>
              ))}
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Все записи журнала действий, системные логи и события доступа старше указанного срока безвозвратно удаляются из зашифрованной базы данных.
            </p>
          </div>

          {/* Temp Files Retention Setting */}
          <div className="space-y-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
            <div className="flex items-center justify-between">
              <label htmlFor="temp-retention-input" className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <HardDrive className="w-4 h-4 text-emerald-400" />
                Срок хранения временных файлов и аудио:
              </label>
              <span className="font-bold text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 font-mono">
                {settings.tempFilesRetentionDays} дней
              </span>
            </div>

            <div className="flex items-center gap-3">
              <input
                id="temp-retention-input"
                type="range"
                min="7"
                max="90"
                step="1"
                value={settings.tempFilesRetentionDays}
                onChange={(e) => setSettings({ ...settings, tempFilesRetentionDays: Number(e.target.value) })}
                className="w-full accent-emerald-500 cursor-pointer"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              {[14, 30, 60, 90].map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setSettings({ ...settings, tempFilesRetentionDays: days })}
                  className={`text-[11px] px-2.5 py-1 rounded transition-colors ${
                    settings.tempFilesRetentionDays === days 
                      ? 'bg-emerald-600 text-white font-bold shadow-xs' 
                      : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  {days} дн. {days === 30 && '(152-ФЗ)'}
                </button>
              ))}
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Файлы во временных директориях (/app/temp, uploads, os.tmpdir), временные WAV/MP3 фрагменты и кэш конвертации SpeechKit очищаются с диска.
            </p>
          </div>
        </div>

        {/* Checkboxes & Switches */}
        <div className="space-y-3 pt-2">
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
              className="mt-0.5 w-4 h-4 rounded border-slate-700 bg-slate-800 text-emerald-600 focus:ring-emerald-500"
            />
            <div className="text-xs">
              <span className="font-semibold text-slate-200 group-hover:text-white transition-colors">
                Включить регламентную процедуру автоматической очистки (152-ФЗ)
              </span>
              <p className="text-slate-400 text-[11px] mt-0.5">
                Автоматически удаляет устаревшие логи, временные файлы и очищает ссылки на аудиозаписи.
              </p>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              checked={settings.autoRunDaily}
              onChange={(e) => setSettings({ ...settings, autoRunDaily: e.target.checked })}
              className="mt-0.5 w-4 h-4 rounded border-slate-700 bg-slate-800 text-emerald-600 focus:ring-emerald-500"
            />
            <div className="text-xs">
              <span className="font-semibold text-slate-200 group-hover:text-white transition-colors">
                Ежедневный запуск по расписанию (раз в 24 часа в 03:00 МСК)
              </span>
              <p className="text-slate-400 text-[11px] mt-0.5">
                Автоматический фоновый запуск процедуры без необходимости ручного вмешательства администратора.
              </p>
            </div>
          </label>
        </div>

        {/* Monitored directories note */}
        {currentStats?.scannedDirs && currentStats.scannedDirs.length > 0 && (
          <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-800/60 text-[11px] text-slate-400 flex items-start gap-2">
            <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
            <div>
              <span>Отслеживаемые директории временных файлов: </span>
              <span className="font-mono text-slate-300">
                {currentStats.scannedDirs.join(', ')}
              </span>
            </div>
          </div>
        )}

        {/* Buttons Row */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-slate-800">
          <button
            type="submit"
            disabled={saving}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <CheckCircle2 className="w-4 h-4" />
            {saving ? 'Сохранение...' : 'Сохранить настройки 152-ФЗ'}
          </button>

          <button
            type="button"
            onClick={handleRunCleanupNow}
            disabled={runningCleanup}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 font-medium text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Play className={`w-3.5 h-3.5 ${runningCleanup ? 'animate-spin' : ''}`} />
            {runningCleanup ? 'Выполняется очистка...' : 'Запустить очистку прямо сейчас'}
          </button>
        </div>
      </form>
    </div>
  );
}
