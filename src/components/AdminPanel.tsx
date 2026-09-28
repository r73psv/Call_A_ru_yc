/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  Key, Users, Lock, ShieldCheck, ShieldAlert, 
  Terminal, Sparkles, AlertCircle, RefreshCw, Trash2
} from 'lucide-react';
import { CredentialsSettings } from './admin/CredentialsSettings.js';
import { UsersManagement } from './admin/UsersManagement.js';
import { AdminPasswordChange } from './admin/AdminPasswordChange.js';
import { AutoCleanupSettingsCard } from './admin/AutoCleanupSettingsCard.js';
import { LogsViewer } from './LogsViewer.js';
import { LogEntry } from '../types.js';

interface AdminPanelProps {
  authToken?: string | null;
  currentUserId?: string;
  adminUsername?: string;
  logs?: LogEntry[];
  onClearLogs?: () => Promise<void>;
}

export function AdminPanel({
  authToken,
  currentUserId,
  adminUsername = 'admin',
  logs = [],
  onClearLogs,
}: AdminPanelProps) {
  const [adminTab, setAdminTab] = useState<'credentials' | 'cleanup' | 'users' | 'password' | 'logs'>('credentials');

  return (
    <div className="space-y-6" id="admin-panel-root">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-teal-950 p-6 rounded-2xl text-white shadow-xs">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-3.5">
            <div className="p-3 bg-white/10 rounded-2xl border border-white/20">
              <ShieldAlert className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold tracking-tight">Панель администратора Remix CallQA</h2>
                <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-bold px-2.5 py-0.5 rounded-full">
                  Защищенный режим
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1">
                Управление системными токенами, внешними интеграциями и разграничением прав сотрудников (152-ФЗ)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-slate-300 bg-black/30 px-3 py-1.5 rounded-xl border border-white/10">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Хранилище: AES-256-GCM /data/data-store.enc</span>
          </div>
        </div>

        {/* Admin Navigation Pills */}
        <div className="flex flex-wrap gap-2 mt-6 pt-4 border-t border-white/10 text-xs">
          <button
            type="button"
            onClick={() => setAdminTab('credentials')}
            className={`px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2 ${
              adminTab === 'credentials'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-white/10 text-slate-200 hover:bg-white/20'
            }`}
            id="admin-tab-credentials"
          >
            <Key className="w-4 h-4" /> Токены, Ключи & Интеграции
          </button>

          <button
            type="button"
            onClick={() => setAdminTab('cleanup')}
            className={`px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2 ${
              adminTab === 'cleanup'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-white/10 text-slate-200 hover:bg-white/20'
            }`}
            id="admin-tab-cleanup"
          >
            <Trash2 className="w-4 h-4 text-amber-400" /> Автоочистка 152-ФЗ (Логи & Файлы)
          </button>

          <button
            type="button"
            onClick={() => setAdminTab('users')}
            className={`px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2 ${
              adminTab === 'users'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-white/10 text-slate-200 hover:bg-white/20'
            }`}
            id="admin-tab-users"
          >
            <Users className="w-4 h-4" /> Управление доступом и пользователями
          </button>

          <button
            type="button"
            onClick={() => setAdminTab('password')}
            className={`px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2 ${
              adminTab === 'password'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-white/10 text-slate-200 hover:bg-white/20'
            }`}
            id="admin-tab-password"
          >
            <Lock className="w-4 h-4" /> Пароль администратора
          </button>

          <button
            type="button"
            onClick={() => setAdminTab('logs')}
            className={`px-4 py-2 rounded-xl font-bold transition-all flex items-center gap-2 ${
              adminTab === 'logs'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'bg-white/10 text-slate-200 hover:bg-white/20'
            }`}
            id="admin-tab-logs"
          >
            <Terminal className="w-4 h-4 text-emerald-300" /> Журнал аудита ({logs.length})
          </button>
        </div>
      </div>

      {/* Tab Panels */}
      <div>
        {adminTab === 'credentials' && (
          <CredentialsSettings authToken={authToken} />
        )}

        {adminTab === 'cleanup' && (
          <AutoCleanupSettingsCard authToken={authToken} />
        )}

        {adminTab === 'users' && (
          <UsersManagement authToken={authToken} currentUserId={currentUserId} />
        )}

        {adminTab === 'password' && (
          <AdminPasswordChange authToken={authToken} adminUsername={adminUsername} />
        )}

        {adminTab === 'logs' && (
          <LogsViewer logs={logs} onClearLogs={onClearLogs} />
        )}
      </div>
    </div>
  );
}
