/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, Plus, Search, Filter, RefreshCw, 
  Trash2, AlertTriangle, CheckCircle2, XCircle, 
  FileText, Smartphone, Mic, HeartHandshake
} from 'lucide-react';
import { ConsentRecord } from '../types.js';
import { ConsentModal } from './ConsentModal.js';

interface ConsentsTableProps {
  userRole?: string;
}

export const ConsentsTable: React.FC<ConsentsTableProps> = ({ userRole = 'admin' }) => {
  const [consents, setConsents] = useState<ConsentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'revoked'>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedPhoneForLoyalty, setSelectedPhoneForLoyalty] = useState('');
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchConsents = async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (statusFilter !== 'all') query.set('status', statusFilter);
      if (search) query.set('search', search);

      const res = await fetch(`/api/consents?${query.toString()}`, {
        headers: { 'x-user-role': userRole },
      });

      if (!res.ok) {
        throw new Error(`Ошибка загрузки: HTTP ${res.status}`);
      }

      const data = await res.json();
      setConsents(data.items || []);
    } catch (err: any) {
      console.error('Failed to load consents:', err);
      setFeedback({ type: 'error', message: err.message || 'Ошибка загрузки согласий' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConsents();
  }, [statusFilter, search]);

  const handleRevoke = async (consentId: string) => {
    setRevokingId(consentId);
    try {
      const res = await fetch(`/api/consents/${consentId}/revoke`, {
        method: 'POST',
        headers: { 'x-user-role': userRole },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Ошибка отзыва согласия');
      }

      setFeedback({
        type: 'success',
        message: 'Согласие успешно отозвано. Персональные данные клиента удалены согласно 152-ФЗ.',
      });
      setRevokeConfirmId(null);
      await fetchConsents();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Ошибка отзыва' });
    } finally {
      setRevokingId(null);
    }
  };

  const getMethodBadge = (method: ConsentRecord['consent_method']) => {
    switch (method) {
      case 'voice':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-200">
            <Mic className="w-3 h-3" /> Голосовое (АТС)
          </span>
        );
      case 'written':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
            <FileText className="w-3 h-3" /> Письменное
          </span>
        );
      case 'digital':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            <Smartphone className="w-3 h-3" /> Электронное
          </span>
        );
    }
  };

  const getPurposePill = (purpose: string) => {
    switch (purpose) {
      case 'quality_control':
        return <span key={purpose} className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px]">Контроль качества</span>;
      case 'ai_analysis':
        return <span key={purpose} className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded text-[10px] font-semibold">ИИ-анализ (GigaChat)</span>;
      case 'loyalty_program':
        return <span key={purpose} className="px-1.5 py-0.5 bg-pink-50 text-pink-700 border border-pink-200 rounded text-[10px] font-semibold flex items-center gap-0.5"><HeartHandshake className="w-2.5 h-2.5" /> Лояльность</span>;
      default:
        return <span key={purpose} className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px]">{purpose}</span>;
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="p-5 border-b border-slate-200 bg-slate-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            <h2 className="font-bold text-slate-800 text-base">
              Реестр согласий на обработку персональных данных (152-ФЗ)
            </h2>
            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-xs font-semibold rounded-full">
              {consents.length}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Зашифрованный журнал фиксации голосовых, письменных и электронных согласий салона «Лик 28»
          </p>
        </div>

        <div className="flex items-center gap-2">
          {userRole === 'admin' && (
            <button
              onClick={() => {
                setSelectedPhoneForLoyalty('');
                setIsModalOpen(true);
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors"
            >
              <Plus className="w-4 h-4" />
              Оформить согласие
            </button>
          )}
          <button
            onClick={fetchConsents}
            disabled={loading}
            className="p-2 text-slate-600 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
            title="Обновить список"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3 text-xs flex items-center justify-between border-b ${
            feedback.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}
        >
          <span>{feedback.message}</span>
          <button onClick={() => setFeedback(null)} className="font-bold text-sm leading-none ml-2">
            &times;
          </button>
        </div>
      )}

      {/* Filters Bar */}
      <div className="p-4 border-b border-slate-200 bg-white flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по маске (****1234)..."
            className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs text-slate-500">Статус:</span>
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50 text-xs">
            {(['all', 'active', 'revoked'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 rounded-md font-medium capitalize transition-all ${
                  statusFilter === st
                    ? 'bg-white text-slate-900 shadow-2xs font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st === 'all' ? 'Все' : st === 'active' ? 'Активные' : 'Отозванные'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Consents Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-200">
              <th className="p-3.5 pl-5">Клиент (Маска)</th>
              <th className="p-3.5">Дата согласия</th>
              <th className="p-3.5">Способ</th>
              <th className="p-3.5">Источник</th>
              <th className="p-3.5">Цели обработки</th>
              <th className="p-3.5">Статус</th>
              <th className="p-3.5 pr-5 text-right">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {consents.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-400">
                  {loading ? 'Загрузка реестра согласий...' : 'Записи согласий не найдены'}
                </td>
              </tr>
            ) : (
              consents.map((c) => {
                const isActive = c.status === 'active';
                const hasLoyalty = c.purposes.includes('loyalty_program');

                return (
                  <tr key={c.consent_id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="p-3.5 pl-5 font-mono font-bold text-slate-900">
                      {c.client_phone_masked}
                    </td>
                    <td className="p-3.5 text-slate-600">
                      {new Date(c.consent_date).toLocaleString('ru-RU', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="p-3.5">
                      {getMethodBadge(c.consent_method)}
                    </td>
                    <td className="p-3.5">
                      <span className="capitalize text-slate-600">
                        {c.consent_source === 'auto' ? 'Авто (звонок)' : 'Ручное (админ)'}
                      </span>
                    </td>
                    <td className="p-3.5">
                      <div className="flex flex-wrap gap-1 max-w-xs">
                        {c.purposes.map((p) => getPurposePill(p))}
                      </div>
                    </td>
                    <td className="p-3.5">
                      {isActive ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3" /> Действует
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-700 font-semibold bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                          <XCircle className="w-3 h-3" /> Отозвано
                        </span>
                      )}
                    </td>
                    <td className="p-3.5 pr-5 text-right">
                      {isActive && userRole === 'admin' ? (
                        <div className="flex items-center justify-end gap-2">
                          {!hasLoyalty && (
                            <button
                              onClick={() => {
                                setSelectedPhoneForLoyalty(c.client_phone_masked);
                                setIsModalOpen(true);
                              }}
                              className="px-2 py-1 text-[11px] font-semibold text-pink-700 bg-pink-50 hover:bg-pink-100 rounded-md border border-pink-200 transition-colors"
                              title="Добавить согласие на программу лояльности"
                            >
                              + Лояльность
                            </button>
                          )}

                          {revokeConfirmId === c.consent_id ? (
                            <div className="inline-flex items-center gap-1 bg-rose-50 p-1 rounded-lg border border-rose-200">
                              <span className="text-[10px] text-rose-800 font-medium">Удалить данные?</span>
                              <button
                                onClick={() => handleRevoke(c.consent_id)}
                                disabled={revokingId === c.consent_id}
                                className="px-1.5 py-0.5 bg-rose-600 text-white rounded text-[10px] font-bold hover:bg-rose-700"
                              >
                                Да
                              </button>
                              <button
                                onClick={() => setRevokeConfirmId(null)}
                                className="px-1.5 py-0.5 text-slate-600 hover:bg-slate-200 rounded text-[10px]"
                              >
                                Отмена
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setRevokeConfirmId(c.consent_id)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                              title="Отозвать согласие клиента (152-ФЗ)"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400 text-[11px]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <ConsentModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onConsentCreated={() => {
            fetchConsents();
            setFeedback({
              type: 'success',
              message: 'Согласие успешно зафиксировано в реестре 152-ФЗ.',
            });
          }}
          initialPhone={selectedPhoneForLoyalty}
          userRole={userRole}
        />
      )}
    </div>
  );
};
