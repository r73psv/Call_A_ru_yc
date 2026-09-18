/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Cloud, CheckCircle2, AlertCircle, RefreshCw, Lock, Database, ArrowUpCircle } from 'lucide-react';

interface S3Status {
  bucket: string;
  key: string;
  endpoint: string;
  connected: boolean;
  synced_at?: string | null;
  error?: string | null;
}

export function S3SyncPanel() {
  const [status, setStatus] = useState<S3Status | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/sync/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (err: any) {
      console.error('Ошибка получения статуса S3:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleManualSync = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMessage({
          text: `Синхронизация успешна (${Math.round((data.size_bytes || 0) / 1024)} КБ зашифровано)`,
          type: 'success',
        });
        await fetchStatus();
      } else {
        setMessage({
          text: data.error || 'Ошибка синхронизации с S3',
          type: 'error',
        });
      }
    } catch (err: any) {
      setMessage({
        text: err.message || 'Ошибка сетевого запроса к S3',
        type: 'error',
      });
    } finally {
      setSyncing(false);
    }
  };

  const formatDateTime = (iso?: string | null) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('ru-RU', {
        dateStyle: 'short',
        timeStyle: 'medium',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
      <div className="flex items-center justify-between pb-4 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center font-bold text-xs">
            <Cloud className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">Хранилище S3 (timeweb.cloud)</h3>
            <p className="text-xs text-slate-500">Зашифрованный бэкап и авто-восстановление при рестарте</p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${
            status?.connected
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-rose-50 text-rose-700 border-rose-200'
          }`}
        >
          {status?.connected ? (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Подключено
            </>
          ) : (
            <>
              <AlertCircle className="w-3.5 h-3.5 text-rose-600" /> {loading ? 'Проверка...' : 'Ошибка подключения'}
            </>
          )}
        </span>
      </div>

      <div className="mt-4 space-y-2.5 text-xs text-slate-600">
        <div className="flex justify-between py-1.5 border-b border-slate-50">
          <span className="text-slate-500 flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5 text-slate-400" /> Бакет S3:
          </span>
          <span className="font-mono text-slate-800 font-medium">{status?.bucket || '—'}</span>
        </div>

        <div className="flex justify-between py-1.5 border-b border-slate-50">
          <span className="text-slate-500 flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-indigo-500" /> Файл в S3:
          </span>
          <span className="font-mono text-indigo-900 font-semibold bg-indigo-50 px-2 py-0.5 rounded text-[11px]">
            data-store.enc (зашифрованный)
          </span>
        </div>

        <div className="flex justify-between py-1.5 border-b border-slate-50">
          <span className="text-slate-500 flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-emerald-500" /> Алгоритм шифрования:
          </span>
          <span className="font-mono text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded text-[11px]">
            AES-256-GCM
          </span>
        </div>

        <div className="flex justify-between py-1.5 border-b border-slate-50">
          <span className="text-slate-500">Содержимое снимка:</span>
          <span className="text-slate-700 font-medium text-[11px]">
            calls[], logs[], config{}, consents[], access_log[]
          </span>
        </div>

        <div className="flex justify-between py-1.5">
          <span className="text-slate-500">Последняя синхронизация:</span>
          <span className="font-medium text-slate-800">{formatDateTime(status?.synced_at)}</span>
        </div>

        {message && (
          <div
            className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${
              message.type === 'success'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            {message.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{message.text}</span>
          </div>
        )}

        <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
          <button
            type="button"
            onClick={handleManualSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-semibold transition-all shadow-xs disabled:opacity-50"
          >
            <ArrowUpCircle className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Синхронизация...' : 'Принудительная выгрузка'}
          </button>

          <button
            type="button"
            onClick={fetchStatus}
            disabled={loading}
            className="flex items-center gap-1 px-3 py-2 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Обновить статус
          </button>
        </div>
      </div>
    </div>
  );
}
