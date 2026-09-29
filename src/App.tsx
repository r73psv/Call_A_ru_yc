/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  PhoneCall, Settings, Activity, RefreshCw, 
  ShieldAlert, AlertCircle, HardDrive, Shield, ShieldCheck,
  Lock, Unlock, UserCheck, HeartHandshake, Sparkles, 
  CheckCircle2, LogOut, User, Key, KeyRound, BarChart3
} from 'lucide-react';

import { StatsGrid } from './components/StatsGrid.js';
import { CallList } from './components/CallList.js';
import { CallDetails } from './components/CallDetails.js';
import { RecordingNotice } from './components/RecordingNotice.js';
import { ConsentsTable } from './components/ConsentsTable.js';
import { ModelSelector } from './components/ModelSelector.js';
import { LoginModal } from './components/LoginModal.js';
import { UserPasswordChangeModal } from './components/UserPasswordChangeModal.js';
import { AdminPasswordPromptModal } from './components/AdminPasswordPromptModal.js';
import { AdminPanel } from './components/AdminPanel.js';
import { NotificationToastContainer } from './components/NotificationToastContainer.js';
import { NotificationsBell } from './components/NotificationsBell.js';

import { CallRecord, DashboardStats, SystemConfig, LogEntry, GigaChatModel, UserRole } from './types.js';

interface CurrentUserInfo {
  id: string;
  username: string;
  name: string;
  role: UserRole;
}

async function safeFetchJson<T = any>(
  url: string, 
  options?: RequestInit, 
  authToken?: string | null,
  userRole?: UserRole,
  retries = 3, 
  delay = 1000
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> || {}),
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  if (userRole) {
    headers['x-user-role'] = userRole;
  }

  const reqOptions: RequestInit = {
    ...options,
    headers,
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, reqOptions);
      if (!response.ok) {
        if (response.status >= 500 && attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Ошибка (${response.status}): ${response.statusText}`);
      }
      const text = await response.text();
      if (text.trim().startsWith('<')) {
        if (attempt < retries) {
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw new Error('Сервер вернул HTML вместо JSON. Идет перезапуск.');
      }
      return JSON.parse(text) as T;
    } catch (err: any) {
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Не удалось установить соединение с сервером.');
}

export default function App() {
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    totalCalls: 0,
    disputeRate: 0,
    averageScore: 0,
    successRate: 0,
    toneStats: {
      client: { neutral: 0, discontent: 0, aggressive: 0 },
      manager: { neutral: 0, calm: 0, defensive: 0 }
    }
  });
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'list' | 'details' | 'stats' | 'consents' | 'admin'>('list');

  // Auth & Session state
  const [authToken, setAuthToken] = useState<string | null>(() => {
    return localStorage.getItem('callqa_auth_token') || null;
  });

  const [currentUser, setCurrentUser] = useState<CurrentUserInfo | null>(() => {
    try {
      const saved = localStorage.getItem('callqa_user_info');
      if (saved) return JSON.parse(saved);
    } catch {}
    // Default fallback to admin for first launch
    return {
      id: 'usr-admin-1',
      username: 'admin',
      name: 'Главный Администратор',
      role: 'admin',
    };
  });

  const userRole: UserRole = currentUser?.role || 'admin';

  // Admin gate protection
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [isAdminPasswordModalOpen, setIsAdminPasswordModalOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(() => !localStorage.getItem('callqa_auth_token'));
  const [isChangePasswordModalOpen, setIsChangePasswordModalOpen] = useState(false);

  // Notification sound preference (for Toast chimes)
  const [soundEnabled, setSoundEnabled] = useState(() => {
    return localStorage.getItem('callqa_sound_enabled') !== 'false';
  });

  const handleToggleSound = () => {
    setSoundEnabled(prev => {
      const next = !prev;
      localStorage.setItem('callqa_sound_enabled', String(next));
      return next;
    });
  };

  const handleSelectCallFromNotification = (callId: string) => {
    setSelectedCallId(callId);
    setActiveTab('details');
    loadData(true);
  };

  // Synchronize state with backend APIs
  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [callsData, statsData, configData, logsData] = await Promise.all([
        safeFetchJson<CallRecord[]>('/api/calls', {}, authToken, userRole),
        safeFetchJson<DashboardStats>('/api/stats', {}, authToken, userRole),
        safeFetchJson<SystemConfig>('/api/config', {}, authToken, userRole),
        safeFetchJson<LogEntry[]>('/api/logs', {}, authToken, userRole).catch(() => [])
      ]);

      setCalls(callsData);
      setStats(statsData);
      setConfig(configData);
      setLogs(logsData || []);

      if (callsData.length > 0 && !selectedCallId) {
        setSelectedCallId(callsData[0].call_id);
      }
      setError(null);
    } catch (err: any) {
      console.error('Data loading error:', err);
      setError(err.message || 'Ошибка подключения к серверу');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const timer = setInterval(() => {
      loadData(true);
    }, 10000);
    return () => clearInterval(timer);
  }, [selectedCallId, userRole, authToken]);

  const handleLoginSuccess = (user: CurrentUserInfo, token: string) => {
    setCurrentUser(user);
    setAuthToken(token);
    setIsLoginModalOpen(false);
    // Reset admin lock on user change
    setIsAdminUnlocked(false);
    if (user.role !== 'admin' && activeTab === 'admin') {
      setActiveTab('list');
    }
    loadData();
  };

  const handleLogout = async () => {
    try {
      if (authToken) {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${authToken}` },
        });
      }
    } catch {}
    localStorage.removeItem('callqa_auth_token');
    localStorage.removeItem('callqa_user_info');
    localStorage.removeItem('callqa_user_role');
    setAuthToken(null);
    setCurrentUser(null);
    setIsAdminUnlocked(false);
    setIsLoginModalOpen(true);
  };

  const handleOpenAdminTab = () => {
    if (userRole !== 'admin') {
      alert('Доступ в панель администратора разрешен только пользователям с ролью «Администратор»');
      return;
    }

    if (!isAdminUnlocked) {
      setIsAdminPasswordModalOpen(true);
    } else {
      setActiveTab('admin');
    }
  };

  const handleAdminPasswordSuccess = () => {
    setIsAdminUnlocked(true);
    setIsAdminPasswordModalOpen(false);
    setActiveTab('admin');
  };

  const handleModelChange = async (newModel: GigaChatModel) => {
    if (userRole !== 'admin') return;
    try {
      await safeFetchJson('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_gigachat_model: newModel }),
      }, authToken, userRole);
      if (config) {
        setConfig({
          ...config,
          activeModel: newModel,
          default_gigachat_model: newModel,
        });
      }
      await loadData(true);
    } catch (err: any) {
      console.error('Failed to update model:', err);
    }
  };

  const handleSendVk = async (id: string) => {
    try {
      const result = await safeFetchJson<any>(`/api/calls/${id}/send-vk`, { 
        method: 'POST',
      }, authToken, userRole);
      await loadData(true);
      return result;
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  };

  const handleSendYclients = async (id: string) => {
    try {
      const result = await safeFetchJson<any>(`/api/calls/${id}/send-yclients`, { 
        method: 'POST',
      }, authToken, userRole);
      await loadData(true);
      return result.success;
    } catch (err) {
      return false;
    }
  };

  const handleReanalyze = async (id: string) => {
    try {
      const updated = await safeFetchJson<CallRecord>(`/api/calls/${id}/reanalyze`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config?.default_gigachat_model || 'GigaChat:Lite' })
      }, authToken, userRole);
      setCalls(prev => prev.map(c => c.call_id === id ? updated : c));
      await loadData(true);
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  };

  const handleDeleteCall = async (id: string) => {
    try {
      await safeFetchJson(`/api/calls/${id}`, { method: 'DELETE' }, authToken, userRole);
      setCalls(prev => prev.filter(c => c.call_id !== id));
      if (selectedCallId === id) {
        setSelectedCallId(null);
        setActiveTab('list');
      }
      await loadData(true);
    } catch (err: any) {
      alert(`Ошибка удаления звонка: ${err.message}`);
    }
  };

  const handleClearDemoCalls = async () => {
    try {
      await safeFetchJson('/api/calls/clear-demo', { method: 'POST' }, authToken, userRole);
      setCalls(prev => prev.filter(c => !c.is_demo && c.call_id !== 'megafon-call-89101' && c.call_id !== 'megafon-call-89102'));
      if (selectedCallId === 'megafon-call-89101' || selectedCallId === 'megafon-call-89102') {
        setSelectedCallId(null);
        setActiveTab('list');
      }
      await loadData(true);
    } catch (err: any) {
      alert(`Ошибка очистки демо-звонков: ${err.message}`);
    }
  };

  const handleClearLogs = async () => {
    if (userRole !== 'admin') return;
    try {
      await safeFetchJson('/api/logs', { 
        method: 'DELETE',
      }, authToken, userRole);
      setLogs([]);
    } catch (err: any) {
      alert(`Ошибка очистки логов: ${err.message}`);
    }
  };

  const selectedCall = calls.find(c => c.call_id === selectedCallId);

  const getRoleBadgeStyle = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return 'bg-red-50 text-red-700 border-red-200';
      case 'manager':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'operator':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'viewer':
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getRoleLabel = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return '👑 Администратор';
      case 'manager':
        return '👔 Управляющий';
      case 'operator':
        return '🎧 Оператор';
      case 'viewer':
        return '👁️ Наблюдатель';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/70 flex flex-col text-slate-800" id="applet-viewport">
      {/* App Header */}
      <header className="bg-white border-b border-slate-200/80 px-6 py-3.5 sticky top-0 z-40 shadow-xs" id="applet-main-header">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex items-center gap-3">
            <div className="bg-emerald-600 text-white p-2.5 rounded-xl shadow-xs">
              <PhoneCall className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-slate-900 tracking-tight">
                  Remix CallQA AI_RU
                </h1>
                <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3 text-emerald-600" /> 152-ФЗ
                </span>
                <span className="bg-slate-100 text-slate-700 text-[10px] font-mono font-medium px-2 py-0.5 rounded-md">
                  салон «Лик 28»
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
                SpeechKit ролевой + GigaChat (Сбер) + Шифрование AES-256-GCM + RBAC доступ
              </p>
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-2.5">
            {/* Active GigaChat Model Selector (compact) */}
            <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs">
              <span className="text-[11px] text-slate-500 font-medium">Модель:</span>
              <ModelSelector
                currentModel={config?.default_gigachat_model || 'GigaChat:Lite'}
                onSelectModel={handleModelChange}
                disabled={userRole !== 'admin'}
                compact
              />
            </div>

            {/* Current Authenticated User Badge, Change Password & Logout */}
            {currentUser && (
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200/90 rounded-xl px-2.5 py-1 text-xs">
                <div className="flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-slate-500" />
                  <span className="font-bold text-slate-800">{currentUser.name}</span>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${getRoleBadgeStyle(currentUser.role)}`}>
                  {getRoleLabel(currentUser.role)}
                </span>
                <button
                  type="button"
                  onClick={() => setIsChangePasswordModalOpen(true)}
                  className="p-1 hover:bg-indigo-100 text-slate-500 hover:text-indigo-700 rounded-md transition-colors"
                  title="Сменить свой пароль"
                  id="user-change-password-btn"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="p-1 hover:bg-slate-200 text-slate-500 hover:text-slate-800 rounded-md transition-colors"
                  title="Выйти / Сменить пользователя"
                  id="user-logout-btn"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Quick Login button if not logged in */}
            {!currentUser && (
              <button
                type="button"
                onClick={() => setIsLoginModalOpen(true)}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs transition-colors"
              >
                Войти по паролю
              </button>
            )}

            {/* Notifications Center Bell (Admins and Managers) */}
            {(userRole === 'admin' || userRole === 'manager') && (
              <NotificationsBell
                userRole={userRole}
                authToken={authToken}
                onSelectCall={handleSelectCallFromNotification}
                soundEnabled={soundEnabled}
                onToggleSound={handleToggleSound}
              />
            )}

            <button
              onClick={() => loadData(true)}
              className="p-1.5 hover:bg-slate-100 rounded-lg border border-slate-200 text-slate-600 transition-colors"
              title="Обновить данные"
              id="refresh-all-data-btn"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-4 md:p-6 max-w-7xl mx-auto w-full space-y-5" id="applet-main-container">
        
        {/* 152-FZ Auto-Inform Notification Notice */}
        <RecordingNotice />

        {/* Error Alert */}
        {error && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 text-rose-900 text-xs" id="global-error-banner">
            <div className="flex gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold block">Сбой связи с сервером</span>
                {error}
              </div>
            </div>
            <button
              onClick={() => loadData()}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold text-xs transition-colors shrink-0"
            >
              Повторить попытку
            </button>
          </div>
        )}

        {/* Role Warning / Notice */}
        {userRole !== 'admin' && (
          <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-3 flex items-center justify-between text-xs text-blue-900">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-600 shrink-0" />
              <span>
                <strong>Режим ограниченного доступа ({getRoleLabel(userRole)}):</strong> Персональные данные маскированы в соответствии со статьей 7 Федерального закона № 152-ФЗ.
              </span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setIsChangePasswordModalOpen(true)}
                className="text-[11px] font-bold text-indigo-700 hover:underline flex items-center gap-1"
                id="role-banner-change-password-btn"
              >
                <KeyRound className="w-3 h-3" /> Сменить пароль
              </button>
              <button
                type="button"
                onClick={() => setIsLoginModalOpen(true)}
                className="text-[11px] font-bold text-blue-700 hover:underline shrink-0"
              >
                Сменить пользователя
              </button>
            </div>
          </div>
        )}

        {/* Workspace Card with Navigation Tabs */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden min-h-[600px] flex flex-col" id="unified-workspace-container">
          
          {/* Main Navigation Tabs */}
          <div className="flex flex-wrap border-b border-slate-200 bg-slate-50/50" id="main-workspace-tabs-header">
            <button
              id="tab-btn-list"
              onClick={() => setActiveTab('list')}
              className={`px-5 py-3.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
                activeTab === 'list'
                  ? 'border-emerald-600 text-emerald-700 bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <PhoneCall className="w-4 h-4" /> Журнал звонков ({calls.length})
            </button>

            <button
              id="tab-btn-details"
              onClick={() => setActiveTab('details')}
              className={`px-5 py-3.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
                activeTab === 'details'
                  ? 'border-emerald-600 text-emerald-700 bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Activity className="w-4 h-4" /> Анализ & Оценка звонка
            </button>

            <button
              id="tab-btn-stats"
              onClick={() => setActiveTab('stats')}
              className={`px-5 py-3.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
                activeTab === 'stats'
                  ? 'border-emerald-600 text-emerald-700 bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <BarChart3 className="w-4 h-4" /> Аналитика & Статистика
            </button>

            <button
              id="tab-btn-consents"
              onClick={() => setActiveTab('consents')}
              className={`px-5 py-3.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
                activeTab === 'consents'
                  ? 'border-emerald-600 text-emerald-700 bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <ShieldCheck className="w-4 h-4" /> Реестр согласий (152-ФЗ)
            </button>

            {/* Protected Admin Panel Tab */}
            {userRole === 'admin' && (
              <button
                id="tab-btn-admin"
                onClick={handleOpenAdminTab}
                className={`px-5 py-3.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
                  activeTab === 'admin'
                    ? 'border-amber-600 text-amber-800 bg-amber-50/50'
                    : 'border-transparent text-slate-600 hover:text-amber-800'
                }`}
              >
                {isAdminUnlocked ? (
                  <Unlock className="w-4 h-4 text-emerald-600" />
                ) : (
                  <Lock className="w-4 h-4 text-amber-600" />
                )}
                <span>Панель администратора</span>
                {!isAdminUnlocked && (
                  <span className="text-[10px] bg-amber-100 text-amber-800 font-bold px-1.5 py-0.2 rounded-md">
                    Пароль
                  </span>
                )}
              </button>
            )}
          </div>

          {/* Active Tab Workspace Panel */}
          <div className="flex-1 p-5" id="active-tab-workspace-panel">
            <AnimatePresence mode="wait">
              {activeTab === 'list' && (
                <motion.div
                  key="tab-workspace-list"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.12 }}
                  className="min-h-[500px]"
                >
                  <CallList 
                    calls={calls} 
                    selectedCallId={selectedCallId} 
                    onSelectCall={(id) => {
                      setSelectedCallId(id);
                      setActiveTab('details');
                    }}
                    onClearDemoCalls={handleClearDemoCalls}
                    userRole={userRole}
                  />
                </motion.div>
              )}

              {activeTab === 'details' && (
                <motion.div
                  key="tab-workspace-details"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.12 }}
                  className="min-h-[500px]"
                >
                  {selectedCall ? (
                    <CallDetails 
                      call={selectedCall} 
                      onSendVk={handleSendVk}
                      onSendYclients={handleSendYclients}
                      onReanalyze={handleReanalyze}
                      onCallUpdated={(updated) => {
                        setCalls(prev => prev.map(c => c.call_id === updated.call_id ? updated : c));
                      }}
                      onDeleteCall={handleDeleteCall}
                      userRole={userRole}
                    />
                  ) : (
                    <div className="bg-white border border-slate-100 rounded-2xl shadow-xs py-16 flex flex-col items-center justify-center p-8 text-center text-slate-400">
                      <PhoneCall className="w-12 h-12 text-slate-300 mb-3" />
                      <h3 className="text-sm font-semibold text-slate-700 mb-1">Звонок не выбран</h3>
                      <p className="text-xs mb-4">Для детального просмотра аналитики сначала выберите звонок в Журнале звонков.</p>
                      <button 
                        onClick={() => setActiveTab('list')}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-xs"
                      >
                        Перейти к Журналу звонков
                      </button>
                    </div>
                  )}
                </motion.div>
              )}

              {activeTab === 'stats' && (
                <motion.div
                  key="tab-workspace-stats"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.12 }}
                  className="min-h-[500px]"
                >
                  <StatsGrid stats={stats} calls={calls} />
                </motion.div>
              )}

              {activeTab === 'consents' && (
                <motion.div
                  key="tab-workspace-consents"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.12 }}
                  className="min-h-[500px]"
                >
                  <ConsentsTable userRole={userRole} />
                </motion.div>
              )}

              {/* Admin Panel (Tokens, Users, Passwords) */}
              {activeTab === 'admin' && userRole === 'admin' && (
                <motion.div
                  key="tab-workspace-admin"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.12 }}
                >
                  <AdminPanel
                    authToken={authToken}
                    currentUserId={currentUser?.id}
                    adminUsername={currentUser?.username}
                    logs={logs}
                    onClearLogs={handleClearLogs}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

        </div>

      </main>

      {/* Login Modal */}
      <LoginModal
        isOpen={isLoginModalOpen}
        onLoginSuccess={handleLoginSuccess}
        onOpenChangePassword={() => setIsChangePasswordModalOpen(true)}
      />

      {/* User Self-Service Password Change Modal */}
      <UserPasswordChangeModal
        isOpen={isChangePasswordModalOpen}
        onClose={() => setIsChangePasswordModalOpen(false)}
        currentUser={currentUser}
        authToken={authToken}
      />

      {/* Admin Gate Master Password Prompt Modal */}
      <AdminPasswordPromptModal
        isOpen={isAdminPasswordModalOpen}
        authToken={authToken}
        onSuccess={handleAdminPasswordSuccess}
        onCancel={() => setIsAdminPasswordModalOpen(false)}
      />

      {/* Real-time Toast Notifications for Admins and Managers */}
      <NotificationToastContainer
        userRole={userRole}
        authToken={authToken}
        onSelectCall={handleSelectCallFromNotification}
        onNewNotification={() => loadData(true)}
        soundEnabled={soundEnabled}
      />

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-4 text-center text-xs text-slate-500 mt-auto" id="applet-main-footer">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row justify-between items-center gap-2">
          <p>© 2026 Салон красоты «Лик 28». Все права защищены. Обработка ПДн в строгом соответствии с 152-ФЗ.</p>
          <div className="flex items-center gap-3 font-mono text-[11px] text-slate-600">
            <span className="flex items-center gap-1 text-emerald-700">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> AES-256-GCM
            </span>
            <span>•</span>
            <span>SpeechKit + GigaChat</span>
            <span>•</span>
            <span className="text-amber-700">Admin RBAC Gate</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
