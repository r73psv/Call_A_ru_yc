/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  PhoneCall, Settings, Terminal, Activity, RefreshCw, 
  ShieldAlert, AlertCircle, HardDrive, Shield, ShieldCheck,
  Lock, UserCheck, HeartHandshake, Bot, Sparkles, CheckCircle2
} from 'lucide-react';

import { StatsGrid } from './components/StatsGrid.js';
import { CallList } from './components/CallList.js';
import { CallDetails } from './components/CallDetails.js';
import { MegafonSimulator } from './components/MegafonSimulator.js';
import { IntegrationsPanel } from './components/IntegrationsPanel.js';
import { LogsViewer } from './components/LogsViewer.js';
import { RecordingNotice } from './components/RecordingNotice.js';
import { ConsentsTable } from './components/ConsentsTable.js';
import { ModelSelector } from './components/ModelSelector.js';

import { CallRecord, DashboardStats, SystemConfig, LogEntry, GigaChatModel } from './types.js';

async function safeFetchJson<T = any>(url: string, options?: RequestInit, retries = 3, delay = 1000): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);
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
  const [activeTab, setActiveTab] = useState<'list' | 'details' | 'consents' | 'simulator' | 'config' | 'logs'>('list');

  // Role based access: admin, manager, viewer
  const [userRole, setUserRole] = useState<'admin' | 'manager' | 'viewer'>(() => {
    return (localStorage.getItem('callqa_user_role') as any) || 'admin';
  });

  const handleRoleChange = (newRole: 'admin' | 'manager' | 'viewer') => {
    setUserRole(newRole);
    localStorage.setItem('callqa_user_role', newRole);
  };

  // Synchronize state with backend APIs
  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const headers = { 'x-user-role': userRole };
      const [callsData, statsData, configData, logsData] = await Promise.all([
        safeFetchJson<CallRecord[]>('/api/calls', { headers }),
        safeFetchJson<DashboardStats>('/api/stats', { headers }),
        safeFetchJson<SystemConfig>('/api/config', { headers }),
        safeFetchJson<LogEntry[]>('/api/logs', { headers })
      ]);

      setCalls(callsData);
      setStats(statsData);
      setConfig(configData);
      setLogs(logsData);

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
  }, [selectedCallId, userRole]);

  const handleSaveConfig = async (newConfig: SystemConfig) => {
    try {
      const updated = await safeFetchJson<SystemConfig>('/api/config', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-role': userRole,
        },
        body: JSON.stringify(newConfig)
      });
      setConfig(updated);
      await loadData(true);
    } catch (err: any) {
      alert(`Ошибка обновления конфигурации: ${err.message}`);
    }
  };

  const handleModelChange = async (newModel: GigaChatModel) => {
    if (userRole !== 'admin') return;
    try {
      await safeFetchJson('/api/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': userRole,
        },
        body: JSON.stringify({ default_gigachat_model: newModel }),
      });
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

  const handleSimulateWebhook = async (payload: {
    client_phone: string;
    client_name: string;
    operator_name: string;
    transcriptPresetId: string;
    duration: number;
    status: string;
  }) => {
    try {
      const result = await safeFetchJson<any>('/api/calls/simulate-webhook', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-user-role': userRole,
        },
        body: JSON.stringify(payload)
      });
      
      if (result.call_id) {
        setSelectedCallId(result.call_id);
        setActiveTab('details');
      }
      await loadData(true);
    } catch (err: any) {
      alert(`Ошибка симуляции: ${err.message}`);
    }
  };

  const handleSendVk = async (id: string) => {
    try {
      const result = await safeFetchJson<any>(`/api/calls/${id}/send-vk`, { 
        method: 'POST',
        headers: { 'x-user-role': userRole },
      });
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
        headers: { 'x-user-role': userRole },
      });
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
        headers: { 
          'Content-Type': 'application/json',
          'x-user-role': userRole,
        },
        body: JSON.stringify({ model: config?.default_gigachat_model || 'GigaChat:Lite' })
      });
      setCalls(prev => prev.map(c => c.call_id === id ? updated : c));
      await loadData(true);
      return true;
    } catch (err) {
      console.error(err);
      return false;
    }
  };

  const handleClearLogs = async () => {
    if (userRole !== 'admin') return;
    try {
      await safeFetchJson('/api/logs', { 
        method: 'DELETE',
        headers: { 'x-user-role': userRole },
      });
      setLogs([]);
    } catch (err: any) {
      alert(`Ошибка очистки логов: ${err.message}`);
    }
  };

  const selectedCall = calls.find(c => c.call_id === selectedCallId);

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
                SpeechKit ролевой + GigaChat (Сбер) + Шифрование AES-256-GCM
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

            {/* Role Switcher */}
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
              <UserCheck className="w-3.5 h-3.5 text-slate-500 ml-1" />
              {(['admin', 'manager', 'viewer'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => handleRoleChange(r)}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all ${
                    userRole === r
                      ? 'bg-white text-slate-900 shadow-2xs font-bold'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                  title={
                    r === 'admin'
                      ? 'Администратор: полный доступ к ПДн, настройкам и расшифровкам'
                      : r === 'manager'
                      ? 'Управляющий: оценки, резюме и флаги конфликтов (без транскриптов по 152-ФЗ)'
                      : 'Наблюдатель: только агрегированная статистика'
                  }
                >
                  {r === 'admin' ? 'Админ' : r === 'manager' ? 'Управляющий' : 'Наблюдатель'}
                </button>
              ))}
            </div>

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

        {/* Statistics Grid */}
        <StatsGrid stats={stats} />

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

            <button
              id="tab-btn-simulator"
              onClick={() => setActiveTab('simulator')}
              className={`px-5 py-3.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
                activeTab === 'simulator'
                  ? 'border-emerald-600 text-emerald-700 bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Bot className="w-4 h-4" /> Симулятор АТС Мегафон
            </button>

            <button
              id="tab-btn-config"
              onClick={() => setActiveTab('config')}
              className={`px-5 py-3.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
                activeTab === 'config'
                  ? 'border-emerald-600 text-emerald-700 bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Settings className="w-4 h-4" /> Интеграции & 152-ФЗ
            </button>

            <button
              id="tab-btn-logs"
              onClick={() => setActiveTab('logs')}
              className={`px-5 py-3.5 text-xs font-bold border-b-2 transition-all flex items-center gap-2 ${
                activeTab === 'logs'
                  ? 'border-emerald-600 text-emerald-700 bg-white'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Terminal className="w-4 h-4" /> Журнал доступа к ПДн ({logs.length})
            </button>
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

              {activeTab === 'simulator' && (
                <motion.div
                  key="tab-workspace-simulator"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.12 }}
                >
                  <MegafonSimulator 
                    onSimulate={handleSimulateWebhook} 
                    activeModel={config?.default_gigachat_model || 'GigaChat:Lite'} 
                  />
                </motion.div>
              )}

              {activeTab === 'config' && config && (
                <motion.div
                  key="tab-workspace-config"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.12 }}
                >
                  <IntegrationsPanel 
                    config={config} 
                    onSaveConfig={handleSaveConfig} 
                    userRole={userRole}
                  />
                </motion.div>
              )}

              {activeTab === 'logs' && (
                <motion.div
                  key="tab-workspace-logs"
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  transition={{ duration: 0.12 }}
                >
                  <LogsViewer 
                    logs={logs} 
                    onClearLogs={handleClearLogs} 
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

        </div>

      </main>

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
          </div>
        </div>
      </footer>
    </div>
  );
}
