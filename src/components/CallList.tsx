/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Search, Filter, AlertTriangle, CheckCircle, Clock, XCircle, RefreshCw, Download, ExternalLink, Zap, ShieldCheck } from 'lucide-react';
import { CallRecord } from '../types.js';

interface CallListProps {
  calls: CallRecord[];
  selectedCallId: string | null;
  onSelectCall: (id: string) => void;
}

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  missed: { label: 'Пропущен', className: 'bg-amber-50 text-amber-600 border-amber-200' },
  Cancel: { label: 'Отменен', className: 'bg-rose-50 text-rose-600 border-rose-200' },
  Busy: { label: 'Занято', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  NotAvailable: { label: 'Недоступен', className: 'bg-slate-100 text-slate-600 border-slate-300' },
  NotAllowed: { label: 'Запрещен', className: 'bg-red-50 text-red-600 border-red-200' },
  NotFound: { label: 'Не найден', className: 'bg-purple-50 text-purple-600 border-purple-200' }
};

export function CallList({ calls, selectedCallId, onSelectCall }: CallListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [modelFilter, setModelFilter] = useState<string>('all');
  const [disputeFilter, setDisputeFilter] = useState<string>('all');
  const [outcomeFilter, setOutcomeFilter] = useState<string>('all');

  // Filter calculations
  const filteredCalls = calls.filter(call => {
    const maskedPhone = call.client_phone_masked || '';
    const matchesSearch = 
      (call.client_name?.toLowerCase().includes(searchTerm.toLowerCase()) || false) ||
      maskedPhone.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (call.operator_name?.toLowerCase().includes(searchTerm.toLowerCase()) || false) ||
      call.call_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      call.transcript.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesModel = modelFilter === 'all' || call.model_used === modelFilter;
    
    const matchesDispute = 
      disputeFilter === 'all' || 
      (disputeFilter === 'dispute' && call.key_facts?.is_dispute === true) ||
      (disputeFilter === 'no_dispute' && call.key_facts?.is_dispute === false);

    const matchesOutcome = 
      outcomeFilter === 'all' || 
      call.key_facts?.call_outcome === outcomeFilter;

    return matchesSearch && matchesModel && matchesDispute && matchesOutcome;
  });

  const getScoreColor = (score: number | null | undefined) => {
    if (score === null || score === undefined) return 'bg-slate-100 text-slate-500 border-slate-200';
    if (score >= 8) return 'bg-green-100 text-green-700 border-green-200';
    if (score >= 5) return 'bg-amber-100 text-amber-700 border-amber-200';
    return 'bg-red-100 text-red-700 border-red-200';
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleString('ru-RU', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Samara'
    });
  };

  return (
    <div className="flex flex-col h-full bg-white border border-slate-100 rounded-2xl shadow-xs overflow-hidden" id="call-list-panel">
      {/* Search Header */}
      <div className="p-4 border-b border-slate-100 bg-slate-50/50 space-y-3">
        <div className="flex justify-between items-center">
          <h2 className="text-sm font-semibold text-slate-800 tracking-tight">Журнал звонков ({filteredCalls.length})</h2>
        </div>
        
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            id="search-calls-input"
            type="text"
            placeholder="Поиск по клиенту (****1234), тексту, ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
          />
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="p-3 border-b border-slate-100 grid grid-cols-3 gap-2 bg-slate-50/30">
        <div>
          <label className="block text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1">ИИ-Модель</label>
          <select
            id="filter-model-select"
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
            className="w-full text-xs bg-white border border-slate-200 rounded-lg p-1.5 focus:outline-hidden focus:border-slate-400"
          >
            <option value="all">Все модели</option>
            <option value="GigaChat:Lite">GigaChat:Lite</option>
            <option value="GigaChat:Pro">GigaChat:Pro</option>
            <option value="GigaChat:Max">GigaChat:Max</option>
          </select>
        </div>
        
        <div>
          <label className="block text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1">Конфликты</label>
          <select
            id="filter-dispute-select"
            value={disputeFilter}
            onChange={(e) => setDisputeFilter(e.target.value)}
            className="w-full text-xs bg-white border border-slate-200 rounded-lg p-1.5 focus:outline-hidden focus:border-slate-400"
          >
            <option value="all">Все</option>
            <option value="dispute">Только споры</option>
            <option value="no_dispute">Без конфликтов</option>
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-medium text-slate-400 uppercase tracking-wider mb-1">Итог звонка</label>
          <select
            id="filter-outcome-select"
            value={outcomeFilter}
            onChange={(e) => setOutcomeFilter(e.target.value)}
            className="w-full text-xs bg-white border border-slate-200 rounded-lg p-1.5 focus:outline-hidden focus:border-slate-400"
          >
            <option value="all">Все итоги</option>
            <option value="успешно">Успешно</option>
            <option value="не успешно">Не успешно</option>
            <option value="перенесён">Перенесён</option>
          </select>
        </div>
      </div>

      {/* Call Cards Container */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100" id="call-cards-scroll-container">
        {filteredCalls.length === 0 ? (
          <div className="p-8 text-center" id="empty-call-list-state">
            <p className="text-sm text-slate-400">Звонки не найдены по выбранным фильтрам</p>
          </div>
        ) : (
          filteredCalls.map((call) => {
            const isSelected = call.call_id === selectedCallId;
            const displayName = call.client_phone_masked || call.client_name || 'Неизвестный клиент';

            return (
              <div
                key={call.call_id}
                id={`call-card-${call.call_id}`}
                onClick={() => onSelectCall(call.call_id)}
                className={`p-4 cursor-pointer text-left transition-all duration-150 relative border-l-3 ${
                  isSelected 
                    ? 'bg-emerald-50/50 border-l-emerald-600' 
                    : 'hover:bg-slate-50 border-l-transparent'
                }`}
              >
                <div className="flex justify-between items-start mb-1.5">
                  <div className="space-y-0.5 w-[70%]">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-mono font-medium text-slate-400 uppercase">
                        {call.call_id.substring(0, 14)}
                      </span>
                      {call.consent_status === 'active' && (
                        <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1 py-0.2 rounded flex items-center gap-0.5">
                          <ShieldCheck className="w-2.5 h-2.5" /> 152-ФЗ
                        </span>
                      )}
                      {call.audio_deleted && (
                        <span className="text-[9px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-1 py-0.2 rounded">
                          TTL audio
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-semibold text-slate-800 leading-tight flex items-center gap-1.5">
                      {call.type === 'outgoing' ? (
                        <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-1 py-0.5 rounded border border-blue-200/50 uppercase shrink-0" title="Исходящий звонок">Исх</span>
                      ) : (
                        <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1 py-0.5 rounded border border-emerald-200/50 uppercase shrink-0" title="Входящий звонок">Вх</span>
                      )}
                      <span className="truncate">{displayName}</span>
                    </h3>
                  </div>
                  
                  {call.status === 'processing' ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700 animate-pulse flex items-center gap-1 shrink-0">
                      <RefreshCw className="w-2.5 h-2.5 animate-spin" /> Анализ...
                    </span>
                  ) : call.status === 'failed' ? (
                    <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-700 flex items-center gap-1 shrink-0">
                      <XCircle className="w-2.5 h-2.5" /> Сбой
                    </span>
                  ) : STATUS_BADGES[call.status] ? (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border shrink-0 ${STATUS_BADGES[call.status].className}`} id={`status-badge-${call.status}-${call.call_id}`}>
                      {STATUS_BADGES[call.status].label}
                    </span>
                  ) : (
                    <span className={`text-xs px-2.5 py-0.5 rounded-full border font-bold shrink-0 ${getScoreColor(call.operator_score)}`}>
                      {call.operator_score !== null && call.operator_score !== undefined ? `${call.operator_score}/10` : '—'}
                    </span>
                  )}
                </div>

                <div className="text-xs text-slate-500 line-clamp-2 mb-2.5">
                  {call.summary || call.transcript || 'Загрузка...'}
                </div>

                <div className="flex justify-between items-center text-[11px] text-slate-400">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {formatDuration(call.duration_seconds)}
                    </span>
                    <span className="font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60 px-1.5 py-0.2 rounded-sm text-[10px]">
                      {call.model_used || 'GigaChat:Lite'}
                    </span>
                  </div>
                  <span>{formatDate(call.timestamp)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
