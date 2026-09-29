/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  AlertTriangle, Check, ShieldAlert, Star, 
  ThumbsUp, Volume2, MessageSquare, 
  MessageCircle, Database, Download, ExternalLink, Zap,
  ShieldCheck, Lock, Clock, Mic, FileText, FileSpreadsheet, Smartphone, HeartHandshake,
  CheckCircle2, XCircle, HelpCircle, Tag, Tags, Plus, X, Bookmark, Trash2
} from 'lucide-react';
import { CallRecord } from '../types.js';
import { ReanalyzeButton } from './ReanalyzeButton.js';
import { refineTranscriptRoles } from '../services/transcriptUtils.js';

interface CallDetailsProps {
  call: CallRecord;
  onSendVk: (id: string) => Promise<{ success: boolean; error?: string }>;
  onSendYclients: (id: string) => Promise<boolean>;
  onReanalyze?: (id: string) => Promise<boolean>;
  onCallUpdated?: (updated: CallRecord) => void;
  onDeleteCall?: (id: string) => Promise<void>;
  userRole?: string;
}

const PRESET_TAGS = [
  { name: 'Запись', color: 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100' },
  { name: 'Продажа', color: 'bg-blue-50 text-blue-800 border-blue-300 hover:bg-blue-100' },
  { name: 'Жалоба', color: 'bg-rose-50 text-rose-800 border-rose-300 hover:bg-rose-100' },
  { name: 'Конфликт', color: 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100' },
  { name: 'VIP-клиент', color: 'bg-purple-50 text-purple-800 border-purple-300 hover:bg-purple-100' },
  { name: 'Перезвонить', color: 'bg-amber-50 text-amber-800 border-amber-300 hover:bg-amber-100' },
  { name: 'Консультация', color: 'bg-sky-50 text-sky-800 border-sky-300 hover:bg-sky-100' },
  { name: 'Спам', color: 'bg-slate-100 text-slate-800 border-slate-300 hover:bg-slate-200' },
  { name: 'Срочно', color: 'bg-red-50 text-red-800 border-red-300 hover:bg-red-100' },
];

export function getTagBadgeStyle(tag: string) {
  const lower = tag.toLowerCase();
  if (lower.includes('жалоб') || lower.includes('конфликт') || lower.includes('претензи') || lower.includes('срочн') || lower.includes('отказ')) {
    return 'bg-rose-50 text-rose-700 border-rose-200';
  }
  if (lower.includes('запис') || lower.includes('соглас') || lower.includes('успешн')) {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }
  if (lower.includes('продаж') || lower.includes('сертификат') || lower.includes('допродаж')) {
    return 'bg-blue-50 text-blue-700 border-blue-200';
  }
  if (lower.includes('vip') || lower.includes('вип') || lower.includes('лояльн') || lower.includes('постоян')) {
    return 'bg-purple-50 text-purple-700 border-purple-200';
  }
  if (lower.includes('перезвон') || lower.includes('уточн') || lower.includes('в работ')) {
    return 'bg-amber-50 text-amber-700 border-amber-200';
  }
  if (lower.includes('спам') || lower.includes('ошиб')) {
    return 'bg-slate-100 text-slate-700 border-slate-300';
  }
  return 'bg-indigo-50 text-indigo-700 border-indigo-200';
}

export function CallDetails({ 
  call, 
  onSendVk, 
  onSendYclients, 
  onReanalyze,
  onCallUpdated,
  onDeleteCall,
  userRole = 'admin',
}: CallDetailsProps) {
  const [sendingVk, setSendingVk] = useState(false);
  const [sentVk, setSentVk] = useState(false);
  const [sendingYc, setSendingYc] = useState(false);
  const [sentYc, setSentYc] = useState(false);
  const [vkError, setVkError] = useState<string | null>(null);
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'csv' | null>(null);
  const [exportSuccessFormat, setExportSuccessFormat] = useState<'pdf' | 'csv' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Categorical Tag Management State
  const [customTagInput, setCustomTagInput] = useState('');
  const [isTagSubmitting, setIsTagSubmitting] = useState(false);
  const [tagError, setTagError] = useState<string | null>(null);

  const handleAddTag = async (tagToAdd: string) => {
    const clean = tagToAdd.trim().replace(/^#/, '');
    if (!clean) return;
    const currentTags = call.tags || [];
    if (currentTags.includes(clean)) return;

    setIsTagSubmitting(true);
    setTagError(null);
    try {
      const response = await fetch(`/api/calls/${call.call_id}/tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: clean }),
      });
      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        throw new Error(errJson?.error || 'Не удалось сохранить тег');
      }
      const data = await response.json();
      const updatedCall: CallRecord = {
        ...call,
        tags: data.tags || [...currentTags, clean],
      };
      if (onCallUpdated) onCallUpdated(updatedCall);
      setCustomTagInput('');
    } catch (err: any) {
      console.error('Ошибка добавления тега:', err);
      setTagError(err.message || 'Ошибка добавления тега');
      setTimeout(() => setTagError(null), 4000);
    } finally {
      setIsTagSubmitting(false);
    }
  };

  const handleRemoveTag = async (tagToRemove: string) => {
    setIsTagSubmitting(true);
    setTagError(null);
    try {
      const response = await fetch(`/api/calls/${call.call_id}/tags/${encodeURIComponent(tagToRemove)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        throw new Error(errJson?.error || 'Не удалось удалить тег');
      }
      const data = await response.json();
      const updatedCall: CallRecord = {
        ...call,
        tags: data.tags || (call.tags || []).filter(t => t !== tagToRemove),
      };
      if (onCallUpdated) onCallUpdated(updatedCall);
    } catch (err: any) {
      console.error('Ошибка удаления тега:', err);
      setTagError(err.message || 'Ошибка удаления тега');
      setTimeout(() => setTagError(null), 4000);
    } finally {
      setIsTagSubmitting(false);
    }
  };

  React.useEffect(() => {
    setVkError(null);
    setExportError(null);
    setTagError(null);
  }, [call.call_id]);

  const handleExport = async (format: 'pdf' | 'csv') => {
    setExportingFormat(format);
    setExportError(null);
    try {
      const endpoint = format === 'pdf' 
        ? `/api/calls/${call.call_id}/export-pdf`
        : `/api/calls/${call.call_id}/export-csv`;
      const response = await fetch(endpoint);
      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        throw new Error(errJson?.error || `Сбой сервера при формировании ${format.toUpperCase()} (${response.status})`);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Otchet_Lik28_${call.call_id}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setExportSuccessFormat(format);
      setTimeout(() => setExportSuccessFormat(null), 3000);
    } catch (err: any) {
      console.error(`Ошибка экспорта ${format}:`, err);
      setExportError(err.message || `Не удалось сформировать ${format.toUpperCase()}-отчет`);
      setTimeout(() => setExportError(null), 6000);
    } finally {
      setExportingFormat(null);
    }
  };

  const handleVk = async () => {
    setSendingVk(true);
    setVkError(null);
    const result = await onSendVk(call.call_id);
    setSendingVk(false);
    if (result.success) {
      setSentVk(true);
      setTimeout(() => setSentVk(false), 3000);
    } else {
      setVkError(result.error || 'Произошла ошибка при отправке в VK');
    }
  };

  const handleYc = async () => {
    setSendingYc(true);
    const success = await onSendYclients(call.call_id);
    setSendingYc(false);
    if (success) {
      setSentYc(true);
      setTimeout(() => setSentYc(false), 3000);
    }
  };

  const getScoreColor = (score: number | null | undefined) => {
    if (score === null || score === undefined) return 'text-slate-500 bg-slate-50 border-slate-200';
    if (score >= 8) return 'text-green-600 bg-green-50 border-green-200';
    if (score >= 5) return 'text-amber-600 bg-amber-50 border-amber-200';
    return 'text-red-600 bg-red-50 border-red-200';
  };

  const getOutcomeColor = (outcome: string) => {
    const o = (outcome || '').toLowerCase();
    if (o === 'запись' || o === 'успешно') return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    if (o === 'консультация' || o === 'перезвон' || o === 'перенесён') return 'bg-blue-50 text-blue-800 border-blue-200';
    if (o === 'отказ' || o === 'отмена') return 'bg-amber-50 text-amber-800 border-amber-200';
    if (o === 'автоответчик') return 'bg-slate-100 text-slate-700 border-slate-200';
    return 'bg-red-50 text-red-800 border-red-200';
  };

  // Считывание статуса записи из нового JSON-поля анализа ИИ (call.booking_status / call.key_facts?.booking_status)
  const bookingStatusRaw = useMemo(() => {
    const direct = (call.booking_status || call.key_facts?.booking_status || '').toLowerCase().trim();
    if (direct) return direct;
    const outcome = (call.key_facts?.call_outcome || '').toLowerCase().trim();
    if (outcome === 'запись') return 'согласие';
    if (outcome === 'отказ') return 'отказ';
    if (outcome === 'автоответчик') return 'не применимо';
    return '';
  }, [call.booking_status, call.key_facts]);

  const bookingStatusConfig = useMemo(() => {
    if (!bookingStatusRaw) return null;

    if (bookingStatusRaw === 'согласие' || bookingStatusRaw.includes('соглас')) {
      return {
        type: 'consent' as const,
        label: 'Согласие на запись',
        badgeText: '✓ Согласие на запись',
        shortText: 'Согласие',
        badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-300 ring-1 ring-emerald-500/20 shadow-3xs',
        solidClass: 'bg-emerald-600 text-white',
        icon: CheckCircle2,
        desc: 'Клиент согласился на предложенное время, запись подтверждена'
      };
    }

    if (bookingStatusRaw === 'отказ' || bookingStatusRaw.includes('отказ')) {
      return {
        type: 'decline' as const,
        label: 'Отказ от записи',
        badgeText: '✗ Отказ от записи',
        shortText: 'Отказ',
        badgeClass: 'bg-rose-50 text-rose-800 border-rose-300 ring-1 ring-rose-500/20 shadow-3xs',
        solidClass: 'bg-rose-600 text-white',
        icon: XCircle,
        desc: 'Клиент отказался от предложенных вариантов записи'
      };
    }

    if (bookingStatusRaw === 'не применимо') {
      return {
        type: 'na' as const,
        label: 'Запись: Не применимо',
        badgeText: '— Не применимо',
        shortText: 'Н/Д',
        badgeClass: 'bg-slate-100 text-slate-700 border-slate-300 shadow-3xs',
        solidClass: 'bg-slate-500 text-white',
        icon: HelpCircle,
        desc: 'Разговор не состоялся / автоответчик / короткий вызов'
      };
    }

    return {
      type: 'consult' as const,
      label: 'Консультация (без записи)',
      badgeText: 'ℹ Консультация',
      shortText: 'Консультация',
      badgeClass: 'bg-sky-50 text-sky-800 border-sky-300 ring-1 ring-sky-500/20 shadow-3xs',
      solidClass: 'bg-sky-600 text-white',
      icon: HelpCircle,
      desc: 'Справочный диалог без фиксации слота записи'
    };
  }, [bookingStatusRaw]);

  const parsedTranscriptLines = useMemo(() => {
    if (!call.transcript) return [];
    const refined = refineTranscriptRoles(call.transcript);
    const lines = refined.split('\n').filter(line => line.trim().length > 0);

    const clean: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const textOnly = line
        .replace(/^(Менеджер:|Клиент:|Администратор:|Оператор:|Неизвестный:)\s*/i, '')
        .trim()
        .toLowerCase();

      if (clean.length > 0) {
        const prevText = clean[clean.length - 1]
          .replace(/^(Менеджер:|Клиент:|Администратор:|Оператор:|Неизвестный:)\s*/i, '')
          .trim()
          .toLowerCase();

        // Если фраза идентична предыдущей (эхо двух каналов), пропускаем дубликат
        if (textOnly === prevText && textOnly.length > 0) {
          continue;
        }
      }
      clean.push(line);
    }
    return clean;
  }, [call.transcript]);

  const STATUS_DETAILS: Record<string, { title: string; badge: string; desc: string; colorClass: string }> = {
    missed: {
      title: 'Пропущенный звонок',
      badge: 'Пропущенный звонок',
      desc: 'Вызов не был принят оператором, либо исходящий звонок остался без ответа. Запись разговора и стенограмма отсутствуют.',
      colorClass: 'bg-amber-50 text-amber-700 border-amber-200'
    },
    Cancel: {
      title: 'Звонок отменен',
      badge: 'Звонок отменен',
      desc: 'Входящий или исходящий звонок был отменен одной из сторон до установки соединения.',
      colorClass: 'bg-rose-50 text-rose-700 border-rose-200'
    },
    Busy: {
      title: 'Линия занята',
      badge: 'Ответ «Занято»',
      desc: 'Вызываемый абонент занят другим разговором.',
      colorClass: 'bg-amber-50 text-amber-700 border-amber-200'
    },
    NotAvailable: {
      title: 'Абонент недоступен',
      badge: 'Недоступен',
      desc: 'Телефон клиента выключен или находится вне зоны действия сети.',
      colorClass: 'bg-slate-50 text-slate-700 border-slate-200'
    },
    NotAllowed: {
      title: 'Звонки запрещены',
      badge: 'Запрещено',
      desc: 'Направление вызова заблокировано правилами маршрутизации АТС.',
      colorClass: 'bg-red-50 text-red-700 border-red-200'
    },
    NotFound: {
      title: 'Абонент не найден',
      badge: 'Не найден',
      desc: 'Номер не существует в сети оператора связи.',
      colorClass: 'bg-purple-50 text-purple-700 border-purple-200'
    }
  };

  const isUnsuccessful = call.status !== 'completed' && STATUS_DETAILS[call.status];

  if (isUnsuccessful) {
    const details = STATUS_DETAILS[call.status];
    return (
      <div className="bg-white border border-slate-100 rounded-2xl shadow-xs overflow-hidden flex flex-col h-full text-left" id="call-details-panel">
        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono font-medium text-slate-400 uppercase tracking-wide">
                {call.call_id}
              </span>
              <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider border ${details.colorClass}`}>
                {details.badge}
              </span>
              <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                152-ФЗ: Н/Д (Звонок не состоялся)
              </span>
              {call.tags && call.tags.length > 0 && call.tags.map((tag) => (
                <span
                  key={tag}
                  className={`text-[11px] px-2 py-0.5 rounded-full font-semibold border inline-flex items-center gap-1 shadow-3xs ${getTagBadgeStyle(tag)}`}
                >
                  <Tag className="w-3 h-3 opacity-70" />
                  <span>{tag}</span>
                </span>
              ))}
            </div>
            <h1 className="text-lg font-bold text-slate-800">
              {call.client_phone_masked || call.client_name || 'Клиент'} ↔ {call.operator_name || 'Оператор'}
            </h1>
          </div>

          <div className="text-xs text-slate-500 font-medium">
            {new Date(call.timestamp).toLocaleString('ru-RU', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: 'Europe/Samara'
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8 flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-6">
          <div className={`p-4 rounded-full border shadow-xs animate-pulse ${details.colorClass}`}>
            <Volume2 className="w-10 h-10" />
          </div>

          <div className="space-y-2">
            <h2 className="text-base font-bold text-slate-800">
              {details.title}
            </h2>
            <p className="text-xs text-slate-500 leading-relaxed font-normal">
              {details.desc}
            </p>
          </div>

          <div className="w-full bg-slate-50 rounded-2xl p-5 border border-slate-100/80 text-left space-y-4">
            <div>
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Рекомендация для администратора</span>
              <ul className="space-y-2">
                {call.recommendations && call.recommendations.length > 0 ? (
                  call.recommendations.map((rec, idx) => (
                    <li key={idx} className="text-xs text-slate-700 flex items-start gap-2 leading-relaxed">
                      <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0 text-[10px] mt-0.5">!</span>
                      <span>{rec}</span>
                    </li>
                  ))
                ) : (
                  <li className="text-xs text-slate-500">Рекомендаций нет</li>
                )}
              </ul>
            </div>

            {/* Quick Tagging for Unsuccessful Calls */}
            <div className="pt-3 border-t border-slate-200/60">
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Теги вызова:</span>
              <div className="flex flex-wrap gap-1.5 mb-2.5">
                {call.tags && call.tags.length > 0 ? (
                  call.tags.map((tag) => (
                    <span
                      key={tag}
                      className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md border ${getTagBadgeStyle(tag)}`}
                    >
                      <span>{tag}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        disabled={isTagSubmitting}
                        className="hover:opacity-70 p-0.5"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  ))
                ) : (
                  <span className="text-[11px] text-slate-400 italic">Теги не установлены</span>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {['Перезвонить', 'Спам', 'Жалоба', 'Срочно'].map((preset) => {
                  const hasTag = call.tags?.includes(preset);
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => hasTag ? handleRemoveTag(preset) : handleAddTag(preset)}
                      disabled={isTagSubmitting}
                      className={`text-[11px] font-medium px-2 py-0.5 rounded-md border transition-all ${
                        hasTag ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 hover:bg-slate-50 border-slate-200'
                      }`}
                    >
                      {hasTag ? `✓ ${preset}` : `+ ${preset}`}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-100 rounded-2xl shadow-xs overflow-hidden flex flex-col h-full text-left" id="call-details-panel">
      {/* Detail Header */}
      <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <span className="text-xs font-mono font-medium text-slate-400 uppercase tracking-wide">
              {call.call_id}
            </span>

            {(call.is_demo || call.call_id.startsWith('megafon-call-8910')) && (
              <span className="text-[11px] bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-0.5 rounded-full font-bold">
                Демо-образец
              </span>
            )}

            {/* Model Badge */}
            <span className="text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full font-semibold">
              {call.model_used || 'GigaChat:Lite'}
            </span>

            {/* Visual Indicator (Badge) статуса записи из JSON-анализа ИИ */}
            {bookingStatusConfig && (
              <span 
                id={`booking-status-badge-${call.call_id}`}
                className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold inline-flex items-center gap-1 border transition-all ${bookingStatusConfig.badgeClass}`}
                title={`Результат анализа ИИ: ${bookingStatusConfig.desc}`}
              >
                <bookingStatusConfig.icon className="w-3.5 h-3.5 shrink-0" />
                <span>{bookingStatusConfig.label}</span>
              </span>
            )}

            {/* 152-FZ Consent Pill */}
            {call.consent_status === 'active' ? (
              <span className="text-[11px] bg-emerald-100 text-emerald-900 border border-emerald-300 px-2 py-0.5 rounded-full font-semibold inline-flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-700" /> Согласие 152-ФЗ активно
              </span>
            ) : call.consent_status === 'revoked' ? (
              <span className="text-[11px] bg-rose-100 text-rose-800 border border-rose-200 px-2 py-0.5 rounded-full font-semibold">
                Согласие отозвано
              </span>
            ) : (
              <span className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                Н/Д
              </span>
            )}

            {/* Loyalty indicator */}
            {call.consent_purposes?.includes('loyalty_program') && (
              <span className="text-[11px] bg-pink-50 text-pink-700 border border-pink-200 px-2 py-0.5 rounded-full font-semibold inline-flex items-center gap-0.5">
                <HeartHandshake className="w-3 h-3" /> Программа лояльности
              </span>
            )}

            {/* Token count */}
            <span className="text-[11px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-mono font-medium inline-flex items-center gap-1">
              <Zap className="w-3 h-3 text-amber-500" />
              {(call.tokens_used?.total_tokens || 1200).toLocaleString('ru-RU')} токенов
            </span>

            {/* Manager Tags Badges in Header */}
            {call.tags && call.tags.length > 0 && call.tags.map((tag) => (
              <span
                key={tag}
                className={`text-[11px] px-2 py-0.5 rounded-full font-semibold border inline-flex items-center gap-1 shadow-3xs ${getTagBadgeStyle(tag)}`}
                title={`Тег менеджера: ${tag}`}
              >
                <Tag className="w-3 h-3 opacity-70" />
                <span>{tag}</span>
              </span>
            ))}
          </div>

          <h1 className="text-lg font-bold text-slate-800">
            {call.client_phone_masked || call.client_name || 'Клиент'} ↔ {call.operator_name || 'Оператор'}
          </h1>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          {/* GigaChat Reanalyze Button with Model Dropdown */}
          <ReanalyzeButton
            callId={call.call_id}
            currentModel={call.model_used}
            onReanalyzed={(updated) => {
              if (onCallUpdated) onCallUpdated(updated);
            }}
            userRole={userRole}
          />

          <button
            onClick={handleVk}
            disabled={sendingVk || call.status !== 'completed'}
            className={`text-xs font-medium px-3.5 py-1.5 rounded-lg border flex items-center gap-1.5 transition-all ${
              sentVk 
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
            }`}
          >
            {sentVk ? <Check className="w-3.5 h-3.5" /> : <MessageCircle className="w-3.5 h-3.5 text-sky-500" />}
            {sentVk ? 'Отправлено в VK' : 'ВКонтакте (152-ФЗ)'}
          </button>

          <button
            onClick={handleYc}
            disabled={sendingYc || call.status !== 'completed'}
            className={`text-xs font-medium px-3.5 py-1.5 rounded-lg border flex items-center gap-1.5 transition-all ${
              sentYc 
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
            }`}
          >
            {sentYc ? <Check className="w-3.5 h-3.5" /> : <Database className="w-3.5 h-3.5 text-amber-500" />}
            {sentYc ? 'В Yclients' : 'В Yclients CRM'}
          </button>

          {/* 152-ФЗ Export Suite (PDF / CSV) */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5 shadow-3xs" id="export-actions-group">
            {/* PDF Export Button */}
            <button
              onClick={() => handleExport('pdf')}
              disabled={exportingFormat !== null}
              id="export-pdf-report-btn"
              className={`text-xs font-medium px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-all ${
                exportSuccessFormat === 'pdf'
                  ? 'bg-emerald-50 text-emerald-800 font-semibold'
                  : 'text-slate-700 hover:text-indigo-900 hover:bg-slate-50'
              }`}
              title="Экспорт официального отчета аудита оператора в PDF (А4, с графиками и подписью управляющего, 152-ФЗ)"
            >
              {exportingFormat === 'pdf' ? (
                <Zap className="w-3.5 h-3.5 text-amber-500 animate-spin" />
              ) : exportSuccessFormat === 'pdf' ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <FileText className="w-3.5 h-3.5 text-rose-600" />
              )}
              <span>{exportingFormat === 'pdf' ? 'Создание PDF...' : exportSuccessFormat === 'pdf' ? 'PDF скачан' : 'PDF'}</span>
            </button>

            <div className="h-4 w-px bg-slate-200 mx-0.5" />

            {/* CSV Export Button */}
            <button
              onClick={() => handleExport('csv')}
              disabled={exportingFormat !== null}
              id="export-csv-report-btn"
              className={`text-xs font-medium px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-all ${
                exportSuccessFormat === 'csv'
                  ? 'bg-emerald-50 text-emerald-800 font-semibold'
                  : 'text-slate-700 hover:text-emerald-900 hover:bg-slate-50'
              }`}
              title="Экспорт детального отчета в CSV формат для Excel/CRM (с маскированием данных по 152-ФЗ)"
            >
              {exportingFormat === 'csv' ? (
                <Zap className="w-3.5 h-3.5 text-amber-500 animate-spin" />
              ) : exportSuccessFormat === 'csv' ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              )}
              <span>{exportingFormat === 'csv' ? 'Создание CSV...' : exportSuccessFormat === 'csv' ? 'CSV скачан' : 'CSV (152-ФЗ)'}</span>
            </button>
          </div>

          {/* Delete Call Button for Admin & Manager */}
          {onDeleteCall && (userRole === 'admin' || userRole === 'manager') && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Вы уверены, что хотите удалить звонок ${call.call_id} из базы данных?`)) {
                  onDeleteCall(call.call_id);
                }
              }}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 flex items-center gap-1.5 transition-all cursor-pointer shadow-3xs"
              title="Удалить запись звонка"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-600" />
              <span>Удалить</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {vkError && (
          <div className="lg:col-span-12 bg-rose-50 border border-rose-200 rounded-xl p-4 text-xs text-rose-800 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Ошибка отправки в VK:</p>
              <p className="mt-0.5">{vkError}</p>
            </div>
          </div>
        )}

        {exportError && (
          <div className="lg:col-span-12 bg-rose-50 border border-rose-200 rounded-xl p-4 text-xs text-rose-800 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold">Ошибка экспорта отчета:</p>
              <p className="mt-0.5">{exportError}</p>
            </div>
          </div>
        )}

        {/* Left column (Analysis & Recommendations) */}
        <div className="lg:col-span-7 space-y-5">
          {/* Categorical Manager Tags Card */}
          <div className="border border-slate-200/90 rounded-2xl p-4 bg-linear-to-r from-slate-50/70 via-white to-indigo-50/20 shadow-xs space-y-3.5" id="call-tags-management-card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg border border-indigo-200 shadow-3xs">
                  <Tags className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <span>Категориальные теги звонка</span>
                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                      {call.tags?.length || 0}
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-500">Метки для категоризации, поиска и последующего анализа управляющим</p>
                </div>
              </div>
            </div>

            {/* Currently assigned tags */}
            <div className="flex flex-wrap items-center gap-1.5 min-h-[38px] p-2.5 bg-white rounded-xl border border-slate-200/80 shadow-3xs">
              {call.tags && call.tags.length > 0 ? (
                call.tags.map((tag) => (
                  <span
                    key={tag}
                    id={`tag-badge-${tag}`}
                    className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border shadow-3xs transition-all ${getTagBadgeStyle(tag)}`}
                  >
                    <Tag className="w-3 h-3 opacity-70" />
                    <span>{tag}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveTag(tag)}
                      disabled={isTagSubmitting}
                      title={`Удалить тег «${tag}»`}
                      className="hover:opacity-75 hover:scale-115 transition-transform p-0.5 rounded-full cursor-pointer text-current ml-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))
              ) : (
                <span className="text-xs text-slate-400 italic flex items-center gap-1.5 py-0.5">
                  <Bookmark className="w-3.5 h-3.5 text-slate-300" />
                  Теги еще не присвоены. Выберите из частых тегов ниже или добавьте свой.
                </span>
              )}
            </div>

            {/* Quick Presets */}
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                Быстрые теги (нажмите для добавления/удаления):
              </span>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_TAGS.map((preset) => {
                  const isAlreadyAdded = call.tags?.includes(preset.name);
                  return (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => isAlreadyAdded ? handleRemoveTag(preset.name) : handleAddTag(preset.name)}
                      disabled={isTagSubmitting}
                      id={`preset-tag-btn-${preset.name}`}
                      className={`text-xs font-medium px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1 cursor-pointer ${
                        isAlreadyAdded
                          ? 'bg-slate-900 text-white border-slate-900 shadow-3xs font-semibold'
                          : preset.color
                      }`}
                      title={isAlreadyAdded ? `Удалить тег «${preset.name}»` : `Добавить тег «${preset.name}»`}
                    >
                      {isAlreadyAdded ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span>{preset.name}</span>
                        </>
                      ) : (
                        <>
                          <Plus className="w-3 h-3" />
                          <span>{preset.name}</span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Custom Tag Input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAddTag(customTagInput);
              }}
              className="flex items-center gap-2 pt-0.5"
            >
              <div className="relative flex-1">
                <input
                  type="text"
                  value={customTagInput}
                  onChange={(e) => setCustomTagInput(e.target.value)}
                  placeholder="Добавить свой тег (например: Предоплата, Корпоративный, Экспресс)..."
                  className="w-full text-xs bg-white border border-slate-200 rounded-lg pl-3 pr-8 py-2 text-slate-800 placeholder-slate-400 focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20"
                  maxLength={40}
                  disabled={isTagSubmitting}
                />
                {customTagInput && (
                  <button
                    type="button"
                    onClick={() => setCustomTagInput('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={isTagSubmitting || !customTagInput.trim()}
                id="btn-add-custom-tag"
                className="text-xs font-semibold px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg transition-all flex items-center gap-1.5 shadow-3xs shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Добавить</span>
              </button>
            </form>

            {tagError && (
              <p className="text-xs text-rose-600 font-medium">{tagError}</p>
            )}
          </div>

          {/* Summary Box */}
          <div className="border border-slate-100 rounded-xl p-4 bg-white shadow-3xs">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Краткое содержание (Резюме диалога)
              </h3>
              {bookingStatusConfig && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-slate-400 font-medium">Статус записи:</span>
                  <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold inline-flex items-center gap-1 border ${bookingStatusConfig.badgeClass}`}>
                    <bookingStatusConfig.icon className="w-3.5 h-3.5 shrink-0" />
                    <span>{bookingStatusConfig.shortText}</span>
                  </span>
                </div>
              )}
            </div>
            <p className="text-xs text-slate-700 leading-relaxed">
              {call.summary || 'Резюме не сформировано'}
            </p>
          </div>

          {/* Key Facts Box */}
          <div className="border border-slate-100 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3.5">Ключевые факты</h3>

            {/* Визуальный индикатор (badge) статуса записи из JSON-анализа ИИ */}
            {bookingStatusConfig && (
              <div className={`mb-4 p-3 rounded-xl border flex items-start justify-between gap-3 ${
                bookingStatusConfig.type === 'consent'
                  ? 'bg-emerald-50/70 border-emerald-200'
                  : bookingStatusConfig.type === 'decline'
                  ? 'bg-rose-50/70 border-rose-200'
                  : 'bg-slate-50 border-slate-200'
              }`}>
                <div className="flex items-start gap-2.5">
                  <div className={`p-1.5 rounded-lg shrink-0 mt-0.5 ${bookingStatusConfig.solidClass}`}>
                    <bookingStatusConfig.icon className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        Статус записи (ИИ-анализ):
                      </span>
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md border ${bookingStatusConfig.badgeClass}`}>
                        {bookingStatusConfig.badgeText}
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 mt-1 font-normal leading-relaxed">
                      {bookingStatusConfig.desc}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div>
                  <span className="block text-[11px] font-medium text-slate-400 uppercase mb-1">Итог разговора</span>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-md border ${getOutcomeColor(call.key_facts?.call_outcome || 'успешно')}`}>
                    {call.key_facts?.call_outcome?.toUpperCase() || 'УСПЕШНО'}
                  </span>
                </div>

                <div>
                  <span className="block text-[11px] font-medium text-slate-400 uppercase mb-1">Конфликт / Спор</span>
                  {call.key_facts?.is_dispute ? (
                    <div className="flex items-center gap-1.5 bg-red-50 border border-red-100 text-red-700 px-2.5 py-1.5 rounded-lg text-xs font-medium">
                      <ShieldAlert className="w-4 h-4" />
                      <div>
                        <span className="font-semibold block">Обнаружен спор</span>
                        <span className="text-[11px] text-red-600 font-normal">{call.key_facts.dispute_reason}</span>
                      </div>
                    </div>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-600 bg-slate-50 border border-slate-100 px-2.5 py-1 rounded-md font-medium">
                      <ThumbsUp className="w-3.5 h-3.5 text-emerald-500" /> Конфликты отсутствуют
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-3 border-t sm:border-t-0 sm:border-l border-slate-100 sm:pl-4">
                <div>
                  <span className="block text-[11px] font-medium text-slate-400 mb-1.5">Тональность</span>
                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Клиент:</span>
                      <span className="font-semibold px-2 py-0.5 rounded-sm capitalize bg-slate-100 text-slate-700">
                        {call.key_facts?.tone_client || 'нейтральный'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Администратор:</span>
                      <span className="font-semibold px-2 py-0.5 rounded-sm capitalize bg-slate-100 text-slate-700">
                        {call.key_facts?.tone_manager || 'спокойный'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {call.key_facts?.promises && call.key_facts.promises.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <span className="block text-[11px] font-medium text-slate-400 uppercase mb-2">Обещания клиенту:</span>
                <ul className="space-y-1.5 text-xs">
                  {call.key_facts.promises.map((p, idx) => (
                    <li key={idx} className="flex items-start gap-1.5 text-slate-700">
                      <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Trigger phrases */}
          {call.trigger_phrases && call.trigger_phrases.length > 0 && (
            <div className="border border-slate-100 rounded-xl p-4 bg-rose-50/20">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-rose-500" /> Выявленные триггеры недовольства ({call.trigger_phrases.length})
              </h3>
              <div className="space-y-1.5">
                {call.trigger_phrases.map((phrase, idx) => (
                  <div key={idx} className="text-xs italic bg-rose-50 border border-rose-100 text-rose-900 p-2.5 rounded-lg border-l-4 border-l-rose-500">
                    «{phrase}»
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          <div className="border border-slate-100 rounded-xl p-4 bg-blue-50/10">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2.5">
              Рекомендации для администратора
            </h3>
            <ul className="space-y-2 text-xs">
              {call.recommendations && call.recommendations.length > 0 ? (
                call.recommendations.map((rec, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-slate-700 leading-relaxed">
                    <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0 text-[10px]">
                      {idx + 1}
                    </span>
                    <span>{rec}</span>
                  </li>
                ))
              ) : (
                <p className="text-slate-400">Рекомендаций нет</p>
              )}
            </ul>
          </div>
        </div>

        {/* Right column */}
        <div className="lg:col-span-5 space-y-5">
          {/* Operator Score */}
          <div className={`border rounded-xl p-4 ${getScoreColor(call.operator_score)}`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Оценка качества</h3>
              <div className="flex items-baseline gap-0.5">
                <span className="text-2xl font-black font-mono">
                  {call.operator_score !== null && call.operator_score !== undefined ? call.operator_score : '—'}
                </span>
                {call.operator_score !== null && call.operator_score !== undefined && (
                  <span className="text-xs text-slate-400">/ 10</span>
                )}
              </div>
            </div>
            
            {call.operator_comment ? (
              <div className="text-xs text-slate-700 leading-relaxed bg-white/60 p-3 rounded-lg border border-slate-200/50">
                <span className="block font-semibold mb-1">Комментарий аудитора:</span>
                {call.operator_comment}
              </div>
            ) : (
              <div className="text-xs text-slate-500 italic">Комментарии к оценке не зафиксированы</div>
            )}
          </div>

          {/* Audio recording & TTL */}
          <div className="border border-slate-100 rounded-xl p-4 bg-slate-50/50 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Volume2 className="w-4 h-4 text-indigo-500" /> Аудиозапись звонка (152-ФЗ)
            </h3>

            {call.audio_deleted ? (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start gap-2">
                <Clock className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
                <div>
                  <div className="font-semibold">Аудиозапись удалена по регламенту</div>
                  <div className="text-[11px] text-amber-700 mt-0.5">
                    Срок хранения аудиозаписи (30 дней) истек. Запись безвозвратно удалена из хранилища в соответствии с 152-ФЗ.
                  </div>
                </div>
              </div>
            ) : call.audio_url ? (
              <div className="space-y-2">
                <audio 
                  src={
                    (!call.audio_url.startsWith('http') || call.audio_url.includes('megafon') || call.audio_url.includes('cp.megafon.ru'))
                      ? `/api/megafon-ats/record-proxy?url=${encodeURIComponent(call.audio_url)}`
                      : call.audio_url
                  } 
                  controls 
                  className="w-full h-9 rounded-lg"
                  preload="metadata"
                />
                <div className="text-[10px] text-slate-400">
                  * Запись хранится не более 30 дней, затем автоматически очищается ежедневным фоновым заданием.
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-400 italic">Аудиозапись не прикреплена</div>
            )}
          </div>

          {/* Transcript / Privacy Restriction */}
          <div className="border border-slate-100 rounded-xl flex flex-col h-[400px]">
            <div className="p-3.5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4 text-slate-400" /> Стенограмма разговора
              </h3>
              <span className="text-[10px] font-mono font-semibold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-sm">
                SpeechKit ролевой
              </span>
            </div>

            {userRole === 'manager' ? (
              <div className="flex-1 p-6 flex flex-col items-center justify-center text-center bg-slate-50/30">
                <div className="p-3 bg-slate-100 rounded-full text-slate-500 mb-3">
                  <Lock className="w-6 h-6" />
                </div>
                <h4 className="text-xs font-bold text-slate-800 mb-1">
                  Доступ к расшифровке ограничен
                </h4>
                <p className="text-[11px] text-slate-500 max-w-xs leading-relaxed">
                  Согласно политике обработки ПДн (152-ФЗ) и разделению ролей, дословный транскрипт доступен только администраторам. Вы можете просмотреть резюме и оценку качества в левой панели.
                </p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/10">
                {parsedTranscriptLines.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-400 text-xs">
                    Стенограмма отсутствует
                  </div>
                ) : (
                  parsedTranscriptLines.map((line, idx) => {
                    const isManager = line.startsWith('Менеджер:') || line.startsWith('Администратор:') || line.startsWith('Оператор:');
                    const cleanLine = line.replace(/^(Менеджер:|Клиент:|Администратор:|Оператор:|Неизвестный:)\s*/, '');
                    const speakerLabel = line.match(/^(Менеджер:|Клиент:|Администратор:|Оператор:|Неизвестный:)/)?.[0] || 'Неизвестный:';
                    
                    return (
                      <div 
                        key={idx} 
                        className={`flex flex-col max-w-[85%] ${isManager ? 'ml-auto items-end' : 'mr-auto items-start'}`}
                      >
                        <span className="text-[10px] font-medium text-slate-400 mb-0.5 capitalize">
                          {speakerLabel.replace(':', '')}
                        </span>
                        <div className={`p-2.5 rounded-xl text-xs leading-relaxed ${
                          isManager 
                            ? 'bg-indigo-600 text-white rounded-br-none' 
                            : 'bg-white border border-slate-200 text-slate-800 rounded-bl-none shadow-3xs'
                        }`}>
                          {cleanLine}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
