/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  Search, Filter, AlertTriangle, CheckCircle, Clock, XCircle, 
  RefreshCw, Download, ExternalLink, Zap, ShieldCheck, X, 
  RotateCcw, Flame, CheckCircle2, Star, PhoneMissed, SlidersHorizontal,
  ChevronDown, PhoneIncoming, PhoneOutgoing, Tag, Tags
} from 'lucide-react';
import { CallRecord } from '../types.js';
import { getTagBadgeStyle } from './CallDetails.js';

interface CallListProps {
  calls: CallRecord[];
  selectedCallId: string | null;
  onSelectCall: (id: string) => void;
  onClearDemoCalls?: () => Promise<void>;
  userRole?: string;
}

const STATUS_BADGES: Record<string, { label: string; className: string }> = {
  missed: { label: 'Пропущен', className: 'bg-amber-50 text-amber-600 border-amber-200' },
  Cancel: { label: 'Отменен', className: 'bg-rose-50 text-rose-600 border-rose-200' },
  Busy: { label: 'Занято', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  NotAvailable: { label: 'Недоступен', className: 'bg-slate-100 text-slate-600 border-slate-300' },
  NotAllowed: { label: 'Запрещен', className: 'bg-red-50 text-red-600 border-red-200' },
  NotFound: { label: 'Не найден', className: 'bg-purple-50 text-purple-600 border-purple-200' }
};

export function CallList({ calls, selectedCallId, onSelectCall, onClearDemoCalls, userRole }: CallListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [scoreFilter, setScoreFilter] = useState<string>('all');
  const [modelFilter, setModelFilter] = useState<string>('all');
  const [disputeFilter, setDisputeFilter] = useState<string>('all');
  const [tagFilter, setTagFilter] = useState<string>('all');
  const [quickPreset, setQuickPreset] = useState<string>('all');
  const [showExtendedFilters, setShowExtendedFilters] = useState(true);
  const [isClearingDemo, setIsClearingDemo] = useState(false);

  // Check if any demo calls exist
  const hasDemoCalls = useMemo(() => {
    return calls.some(c => c.is_demo || c.call_id === 'megafon-call-89101' || c.call_id === 'megafon-call-89102');
  }, [calls]);

  // Available unique tags across all calls
  const availableTags = useMemo(() => {
    const tagSet = new Set<string>();
    calls.forEach(c => {
      if (Array.isArray(c.tags)) {
        c.tags.forEach(t => {
          if (t && typeof t === 'string' && t.trim()) {
            tagSet.add(t.trim());
          }
        });
      }
    });
    return Array.from(tagSet).sort((a, b) => a.localeCompare(b, 'ru'));
  }, [calls]);

  // Quick statistics calculation for preset chip badges
  const presetStats = useMemo(() => {
    let disputes = 0;
    let booked = 0;
    let declined = 0;
    let lowScore = 0;
    let topScore = 0;
    let missed = 0;
    let processing = 0;

    calls.forEach(call => {
      if (call.key_facts?.is_dispute) disputes++;
      if (call.booking_status === 'согласие' || call.key_facts?.call_outcome === 'запись') booked++;
      if (call.booking_status === 'отказ' || call.key_facts?.call_outcome === 'отказ') declined++;
      if (call.operator_score !== null && call.operator_score !== undefined) {
        if (call.operator_score < 5) lowScore++;
        if (call.operator_score >= 8) topScore++;
      }
      if (call.status === 'missed') missed++;
      if (call.status === 'processing') processing++;
    });

    return { disputes, booked, declined, lowScore, topScore, missed, processing };
  }, [calls]);

  // Main filter engine
  const filteredCalls = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();

    return calls.filter(call => {
      // 1. Keyword search (client name, masked phone, operator, ID, summary, transcript, issues, comments, promises)
      if (term) {
        const maskedPhone = (call.client_phone_masked || '').toLowerCase();
        const clientName = (call.client_name || '').toLowerCase();
        const operatorName = (call.operator_name || '').toLowerCase();
        const callId = (call.call_id || '').toLowerCase();
        const summary = (call.summary || '').toLowerCase();
        const transcript = (call.transcript || '').toLowerCase();
        const comment = (call.operator_comment || '').toLowerCase();
        const issue = (call.key_facts?.client_issue || '').toLowerCase();
        const disputeReason = (call.key_facts?.dispute_reason || '').toLowerCase();
        const triggerPhrases = Array.isArray(call.trigger_phrases) ? call.trigger_phrases.join(' ').toLowerCase() : '';
        const promises = Array.isArray(call.key_facts?.promises) ? call.key_facts.promises.join(' ').toLowerCase() : '';
        const tagText = Array.isArray(call.tags) ? call.tags.join(' ').toLowerCase() : '';

        const matches = 
          maskedPhone.includes(term) ||
          clientName.includes(term) ||
          operatorName.includes(term) ||
          callId.includes(term) ||
          summary.includes(term) ||
          transcript.includes(term) ||
          comment.includes(term) ||
          issue.includes(term) ||
          disputeReason.includes(term) ||
          triggerPhrases.includes(term) ||
          promises.includes(term) ||
          tagText.includes(term);

        if (!matches) return false;
      }

      // 2. Quick preset filter
      if (quickPreset !== 'all') {
        if (quickPreset === 'disputes' && !call.key_facts?.is_dispute) return false;
        if (quickPreset === 'booked' && call.booking_status !== 'согласие' && call.key_facts?.call_outcome !== 'запись') return false;
        if (quickPreset === 'declined' && call.booking_status !== 'отказ' && call.key_facts?.call_outcome !== 'отказ') return false;
        if (quickPreset === 'low_score') {
          const sc = call.operator_score;
          if (sc === null || sc === undefined || sc >= 5) return false;
        }
        if (quickPreset === 'top_score') {
          const sc = call.operator_score;
          if (sc === null || sc === undefined || sc < 8) return false;
        }
        if (quickPreset === 'missed' && call.status !== 'missed') return false;
        if (quickPreset === 'processing' && call.status !== 'processing') return false;
      }

      // 3. Status filter (Анализ и статус записи)
      if (statusFilter !== 'all') {
        if (statusFilter === 'completed' && call.status !== 'completed') return false;
        if (statusFilter === 'processing' && call.status !== 'processing') return false;
        if (statusFilter === 'failed' && call.status !== 'failed') return false;
        if (statusFilter === 'missed' && call.status !== 'missed') return false;
        if (statusFilter === 'booked') {
          const isBooked = call.booking_status === 'согласие' || call.key_facts?.call_outcome === 'запись';
          if (!isBooked) return false;
        }
        if (statusFilter === 'declined') {
          const isDeclined = call.booking_status === 'отказ' || call.key_facts?.call_outcome === 'отказ';
          if (!isDeclined) return false;
        }
        if (statusFilter === 'consultation') {
          const isConsult = call.booking_status === 'консультация' || call.key_facts?.call_outcome === 'консультация';
          if (!isConsult) return false;
        }
      }

      // 4. Operator Score filter
      if (scoreFilter !== 'all') {
        const score = call.operator_score;
        if (scoreFilter === 'high') {
          if (score === null || score === undefined || score < 8) return false;
        } else if (scoreFilter === 'medium') {
          if (score === null || score === undefined || score < 5 || score > 7) return false;
        } else if (scoreFilter === 'low') {
          if (score === null || score === undefined || score >= 5) return false;
        } else if (scoreFilter === 'none') {
          if (score !== null && score !== undefined) return false;
        }
      }

      // 5. Model filter
      if (modelFilter !== 'all') {
        if (call.model_used !== modelFilter) return false;
      }

      // 6. Dispute filter
      if (disputeFilter !== 'all') {
        if (disputeFilter === 'dispute' && !call.key_facts?.is_dispute) return false;
        if (disputeFilter === 'no_dispute' && call.key_facts?.is_dispute) return false;
      }

      // 7. Categorical Tag filter
      if (tagFilter !== 'all') {
        if (!Array.isArray(call.tags) || !call.tags.includes(tagFilter)) return false;
      }

      return true;
    });
  }, [calls, searchTerm, quickPreset, statusFilter, scoreFilter, modelFilter, disputeFilter, tagFilter]);

  // Count active filters
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (searchTerm.trim() !== '') count++;
    if (quickPreset !== 'all') count++;
    if (statusFilter !== 'all') count++;
    if (scoreFilter !== 'all') count++;
    if (modelFilter !== 'all') count++;
    if (disputeFilter !== 'all') count++;
    if (tagFilter !== 'all') count++;
    return count;
  }, [searchTerm, quickPreset, statusFilter, scoreFilter, modelFilter, disputeFilter, tagFilter]);

  const resetAllFilters = () => {
    setSearchTerm('');
    setQuickPreset('all');
    setStatusFilter('all');
    setScoreFilter('all');
    setModelFilter('all');
    setDisputeFilter('all');
    setTagFilter('all');
  };

  const getScoreColor = (score: number | null | undefined) => {
    if (score === null || score === undefined) return 'bg-slate-100 text-slate-500 border-slate-200';
    if (score >= 8) return 'bg-emerald-100 text-emerald-800 border-emerald-300';
    if (score >= 5) return 'bg-amber-100 text-amber-800 border-amber-300';
    return 'bg-rose-100 text-rose-800 border-rose-300';
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
      {/* 1. Header with Title & Search bar */}
      <div className="p-4 border-b border-slate-100 bg-slate-50/50 space-y-3">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-800 tracking-tight">Журнал звонков</h2>
            <span className="text-xs bg-slate-200/70 text-slate-700 font-semibold px-2 py-0.5 rounded-full">
              {filteredCalls.length} из {calls.length}
            </span>
          </div>

          {activeFiltersCount > 0 && (
            <button
              onClick={resetAllFilters}
              id="btn-reset-filters-top"
              className="text-xs text-rose-600 hover:text-rose-800 font-medium inline-flex items-center gap-1 transition-colors"
              title="Сбросить все активные фильтры"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Сбросить ({activeFiltersCount})</span>
            </button>
          )}
        </div>

        {/* Demo Calls Notice Banner */}
        {hasDemoCalls && (
          <div className="bg-amber-50 border border-amber-200/80 rounded-xl p-2.5 flex items-center justify-between gap-3 text-xs text-amber-900">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
              <span>
                <strong>Демо-режим:</strong> Отображаются 2 демонстрационных примера звонков (добавлены по умолчанию до настройки АТС).
              </span>
            </div>
            {onClearDemoCalls && (userRole === 'admin' || userRole === 'manager') && (
              <button
                type="button"
                disabled={isClearingDemo}
                onClick={async () => {
                  if (window.confirm('Удалить демонстрационные примеры звонков из журнала?')) {
                    setIsClearingDemo(true);
                    try {
                      await onClearDemoCalls();
                    } finally {
                      setIsClearingDemo(false);
                    }
                  }
                }}
                className="shrink-0 text-[11px] font-bold px-2.5 py-1 bg-amber-200/90 hover:bg-amber-300 text-amber-950 rounded-lg transition-colors cursor-pointer"
              >
                {isClearingDemo ? 'Удаление...' : 'Очистить демо'}
              </button>
            )}
          </div>
        )}
        
        {/* Search Input with quick clear */}
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            id="search-calls-input"
            type="text"
            placeholder="Поиск по ключевым словам: клиент, оператор, тема, резюме, транскрипт..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-9 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all placeholder:text-slate-400"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 p-0.5 rounded-full"
              title="Очистить поиск"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 2. Quick Presets Bar (Чипы быстрой фильтрации) */}
      <div className="px-3.5 py-2.5 border-b border-slate-100 bg-white overflow-x-auto scrollbar-none" id="quick-filter-chips">
        <div className="flex items-center gap-1.5 min-w-max">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1 flex items-center gap-1">
            <SlidersHorizontal className="w-3 h-3 text-slate-400" /> Фильтры:
          </span>

          {/* Все звонки */}
          <button
            onClick={() => setQuickPreset('all')}
            className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1.5 border ${
              quickPreset === 'all'
                ? 'bg-slate-900 text-white border-slate-900 shadow-3xs'
                : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border-slate-200/80'
            }`}
          >
            <span>Все</span>
            <span className={`text-[10px] px-1 py-0.2 rounded-full ${quickPreset === 'all' ? 'bg-slate-700 text-slate-200' : 'bg-slate-200/60 text-slate-600'}`}>
              {calls.length}
            </span>
          </button>

          {/* Согласие / Запись */}
          <button
            onClick={() => setQuickPreset(quickPreset === 'booked' ? 'all' : 'booked')}
            className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1.5 border ${
              quickPreset === 'booked'
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-3xs'
                : 'bg-emerald-50/70 text-emerald-800 hover:bg-emerald-100/70 border-emerald-200'
            }`}
          >
            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
            <span>Запись</span>
            <span className={`text-[10px] px-1 py-0.2 rounded-full ${quickPreset === 'booked' ? 'bg-emerald-800 text-emerald-100' : 'bg-emerald-100 text-emerald-800 font-bold'}`}>
              {presetStats.booked}
            </span>
          </button>

          {/* Отказ */}
          <button
            onClick={() => setQuickPreset(quickPreset === 'declined' ? 'all' : 'declined')}
            className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1.5 border ${
              quickPreset === 'declined'
                ? 'bg-rose-600 text-white border-rose-600 shadow-3xs'
                : 'bg-rose-50/70 text-rose-800 hover:bg-rose-100/70 border-rose-200'
            }`}
          >
            <XCircle className="w-3 h-3 text-rose-600" />
            <span>Отказ</span>
            <span className={`text-[10px] px-1 py-0.2 rounded-full ${quickPreset === 'declined' ? 'bg-rose-800 text-rose-100' : 'bg-rose-100 text-rose-800 font-bold'}`}>
              {presetStats.declined}
            </span>
          </button>

          {/* Споры / Конфликты */}
          <button
            onClick={() => setQuickPreset(quickPreset === 'disputes' ? 'all' : 'disputes')}
            className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1.5 border ${
              quickPreset === 'disputes'
                ? 'bg-amber-600 text-white border-amber-600 shadow-3xs'
                : 'bg-amber-50/70 text-amber-800 hover:bg-amber-100/70 border-amber-200'
            }`}
          >
            <Flame className="w-3 h-3 text-amber-600" />
            <span>Споры</span>
            <span className={`text-[10px] px-1 py-0.2 rounded-full ${quickPreset === 'disputes' ? 'bg-amber-800 text-amber-100' : 'bg-amber-100 text-amber-800 font-bold'}`}>
              {presetStats.disputes}
            </span>
          </button>

          {/* Низкая оценка (< 5) */}
          <button
            onClick={() => setQuickPreset(quickPreset === 'low_score' ? 'all' : 'low_score')}
            className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1.5 border ${
              quickPreset === 'low_score'
                ? 'bg-red-600 text-white border-red-600 shadow-3xs'
                : 'bg-red-50/70 text-red-800 hover:bg-red-100/70 border-red-200'
            }`}
          >
            <AlertTriangle className="w-3 h-3 text-red-600" />
            <span>Балл &lt; 5</span>
            <span className={`text-[10px] px-1 py-0.2 rounded-full ${quickPreset === 'low_score' ? 'bg-red-800 text-red-100' : 'bg-red-100 text-red-800 font-bold'}`}>
              {presetStats.lowScore}
            </span>
          </button>

          {/* Высокая оценка (>= 8) */}
          <button
            onClick={() => setQuickPreset(quickPreset === 'top_score' ? 'all' : 'top_score')}
            className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1.5 border ${
              quickPreset === 'top_score'
                ? 'bg-indigo-600 text-white border-indigo-600 shadow-3xs'
                : 'bg-indigo-50/70 text-indigo-800 hover:bg-indigo-100/70 border-indigo-200'
            }`}
          >
            <Star className="w-3 h-3 text-indigo-600" />
            <span>Топ (8–10)</span>
            <span className={`text-[10px] px-1 py-0.2 rounded-full ${quickPreset === 'top_score' ? 'bg-indigo-800 text-indigo-100' : 'bg-indigo-100 text-indigo-800 font-bold'}`}>
              {presetStats.topScore}
            </span>
          </button>

          {/* Пропущенные */}
          {presetStats.missed > 0 && (
            <button
              onClick={() => setQuickPreset(quickPreset === 'missed' ? 'all' : 'missed')}
              className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-all flex items-center gap-1.5 border ${
                quickPreset === 'missed'
                  ? 'bg-slate-700 text-white border-slate-700 shadow-3xs'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border-slate-200'
              }`}
            >
              <PhoneMissed className="w-3 h-3 text-slate-500" />
              <span>Пропущенные</span>
              <span className={`text-[10px] px-1 py-0.2 rounded-full ${quickPreset === 'missed' ? 'bg-slate-800 text-slate-200' : 'bg-slate-200 text-slate-700 font-bold'}`}>
                {presetStats.missed}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* 3. Detailed Parameter Filter Selectors (Выпадающие списки точной фильтрации) */}
      <div className="p-3 border-b border-slate-100 bg-slate-50/30 space-y-2">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {/* Статус анализа и записи */}
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Статус анализа
            </label>
            <select
              id="filter-status-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full text-xs bg-white border border-slate-200 rounded-lg p-1.5 focus:outline-hidden focus:border-emerald-500 text-slate-700 font-medium"
            >
              <option value="all">Все статусы</option>
              <option value="completed">✓ Обработан успешно</option>
              <option value="booked">✓ Запись (согласие)</option>
              <option value="declined">✗ Отказ от записи</option>
              <option value="consultation">ℹ Консультация</option>
              <option value="missed">📞 Пропущенный вызов</option>
              <option value="processing">⏳ В обработке</option>
              <option value="failed">⚠ Сбой анализа</option>
            </select>
          </div>

          {/* Оценка оператора */}
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Оценка оператора
            </label>
            <select
              id="filter-score-select"
              value={scoreFilter}
              onChange={(e) => setScoreFilter(e.target.value)}
              className="w-full text-xs bg-white border border-slate-200 rounded-lg p-1.5 focus:outline-hidden focus:border-emerald-500 text-slate-700 font-medium"
            >
              <option value="all">Любая оценка</option>
              <option value="high">🟢 8–10 (Высокая)</option>
              <option value="medium">🟡 5–7 (Средняя)</option>
              <option value="low">🔴 1–4 (Низкая / Спор)</option>
              <option value="none">⚪ Без оценки</option>
            </select>
          </div>

          {/* Конфликты / Претензии */}
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Конфликты
            </label>
            <select
              id="filter-dispute-select"
              value={disputeFilter}
              onChange={(e) => setDisputeFilter(e.target.value)}
              className="w-full text-xs bg-white border border-slate-200 rounded-lg p-1.5 focus:outline-hidden focus:border-emerald-500 text-slate-700 font-medium"
            >
              <option value="all">Все диалоги</option>
              <option value="dispute">🔥 Только со спором</option>
              <option value="no_dispute">🛡️ Без конфликтов</option>
            </select>
          </div>

          {/* ИИ-Модель */}
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              ИИ-Модель
            </label>
            <select
              id="filter-model-select"
              value={modelFilter}
              onChange={(e) => setModelFilter(e.target.value)}
              className="w-full text-xs bg-white border border-slate-200 rounded-lg p-1.5 focus:outline-hidden focus:border-emerald-500 text-slate-700 font-medium"
            >
              <option value="all">Все модели</option>
              <option value="GigaChat:Lite">GigaChat:Lite</option>
              <option value="GigaChat:Pro">GigaChat:Pro</option>
              <option value="GigaChat:Max">GigaChat:Max</option>
              <option value="GigaChat:Ultra">GigaChat:Ultra</option>
            </select>
          </div>

          {/* Тег категории */}
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Тег звонка
            </label>
            <select
              id="filter-tag-select"
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="w-full text-xs bg-white border border-slate-200 rounded-lg p-1.5 focus:outline-hidden focus:border-indigo-500 text-slate-700 font-medium"
            >
              <option value="all">Все теги ({availableTags.length})</option>
              {availableTags.map((tag) => (
                <option key={tag} value={tag}>#{tag}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Quick Tag Pills */}
        {availableTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-slate-100">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-0.5">Теги:</span>
            {availableTags.map((tag) => {
              const isSelected = tagFilter === tag;
              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setTagFilter(isSelected ? 'all' : tag)}
                  className={`text-[10px] px-2 py-0.5 rounded-md font-medium border transition-all flex items-center gap-1 cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-3xs font-semibold'
                      : 'bg-white text-slate-600 hover:bg-slate-100 border-slate-200'
                  }`}
                >
                  <Tag className="w-2.5 h-2.5 opacity-70" />
                  <span>{tag}</span>
                  {isSelected && <X className="w-2.5 h-2.5 ml-0.5" />}
                </button>
              );
            })}
          </div>
        )}

        {/* 4. Active criteria tags & Reset button */}
        {activeFiltersCount > 0 && (
          <div className="flex items-center justify-between pt-1 text-[11px] border-t border-slate-100">
            <span className="text-slate-500 font-medium">
              Применено параметров: <span className="font-bold text-slate-800">{activeFiltersCount}</span>
            </span>
            <button
              onClick={resetAllFilters}
              id="btn-reset-filters"
              className="text-emerald-700 hover:text-emerald-900 font-bold inline-flex items-center gap-1 hover:underline cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Очистить все</span>
            </button>
          </div>
        )}
      </div>

      {/* 5. Call Cards Container */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-100" id="call-cards-scroll-container">
        {filteredCalls.length === 0 ? (
          <div className="p-10 text-center flex flex-col items-center justify-center space-y-3" id="empty-call-list-state">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
              <Filter className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-700">Ничего не найдено</p>
              <p className="text-xs text-slate-400 mt-1 max-w-[280px]">
                По выбранным параметрам фильтрации записей нет. Попробуйте изменить или сбросить фильтры.
              </p>
            </div>
            {activeFiltersCount > 0 && (
              <button
                onClick={resetAllFilters}
                className="mt-2 text-xs font-semibold px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 rounded-lg inline-flex items-center gap-1.5 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Сбросить все фильтры</span>
              </button>
            )}
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
                    ? 'bg-emerald-50/50 border-l-emerald-600 shadow-2xs' 
                    : 'hover:bg-slate-50 border-l-transparent'
                }`}
              >
                <div className="flex justify-between items-start mb-1.5">
                  <div className="space-y-0.5 w-[70%]">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-mono font-medium text-slate-400 uppercase">
                        {call.call_id.substring(0, 14)}
                      </span>
                      {(call.is_demo || call.call_id.startsWith('megafon-call-8910')) && (
                        <span className="text-[9px] font-bold text-amber-800 bg-amber-100 border border-amber-300 px-1.5 py-0.2 rounded" title="Демонстрационный пример звонка">
                          Демо-образец
                        </span>
                      )}
                      {call.consent_status === 'active' && (
                        <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1 py-0.2 rounded flex items-center gap-0.5">
                          <ShieldCheck className="w-2.5 h-2.5" /> 152-ФЗ
                        </span>
                      )}
                      {call.key_facts?.is_dispute && (
                        <span className="text-[9px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1 py-0.2 rounded flex items-center gap-0.5" title="Зафиксирован конфликт/спор">
                          <AlertTriangle className="w-2.5 h-2.5 text-rose-600" /> Спор
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
                        <span className="text-[9px] font-bold text-blue-600 bg-blue-50 px-1 py-0.5 rounded border border-blue-200/50 uppercase shrink-0 inline-flex items-center gap-0.5" title="Исходящий звонок">
                          <PhoneOutgoing className="w-2.5 h-2.5" /> Исх
                        </span>
                      ) : (
                        <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1 py-0.5 rounded border border-emerald-200/50 uppercase shrink-0 inline-flex items-center gap-0.5" title="Входящий звонок">
                          <PhoneIncoming className="w-2.5 h-2.5" /> Вх
                        </span>
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

                <div className="text-xs text-slate-500 line-clamp-2 mb-2">
                  {call.summary || call.transcript || 'Загрузка...'}
                </div>

                {/* Categorical Tags Badges in Call Card */}
                {call.tags && call.tags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1 mb-2.5">
                    {call.tags.map((tag) => (
                      <span
                        key={tag}
                        className={`text-[9px] px-1.5 py-0.5 rounded-md font-semibold border flex items-center gap-0.5 shadow-3xs ${getTagBadgeStyle(tag)}`}
                      >
                        <Tag className="w-2.5 h-2.5 opacity-70" />
                        <span>{tag}</span>
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex justify-between items-center text-[11px] text-slate-400">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {formatDuration(call.duration_seconds)}
                    </span>
                    <span className="font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60 px-1.5 py-0.2 rounded-sm text-[10px]">
                      {call.model_used || 'GigaChat:Lite'}
                    </span>
                    {(call.booking_status || call.key_facts?.booking_status) && (
                      <span className={`font-semibold px-1.5 py-0.2 rounded-sm text-[10px] border ${
                        (call.booking_status || call.key_facts?.booking_status) === 'согласие'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : (call.booking_status || call.key_facts?.booking_status) === 'отказ'
                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : 'bg-slate-50 text-slate-600 border-slate-200'
                      }`}>
                        {(call.booking_status || call.key_facts?.booking_status) === 'согласие' ? 'Запись: да' :
                         (call.booking_status || call.key_facts?.booking_status) === 'отказ' ? 'Отказ' :
                         (call.booking_status || call.key_facts?.booking_status)}
                      </span>
                    )}
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
