/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { X, ShieldCheck, CheckCircle2, AlertCircle, FileText, Smartphone } from 'lucide-react';
import { ConsentRecord } from '../types.js';

interface ConsentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConsentCreated: (consent: ConsentRecord) => void;
  initialPhone?: string;
  userRole?: string;
}

export const ConsentModal: React.FC<ConsentModalProps> = ({
  isOpen,
  onClose,
  onConsentCreated,
  initialPhone = '',
  userRole = 'admin',
}) => {
  const [phone, setPhone] = useState(initialPhone);
  const [method, setMethod] = useState<'written' | 'digital'>('written');
  const [isLoyaltyOnly, setIsLoyaltyOnly] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const clean = phone.replace(/\D/g, '');
      if (clean.length < 10) {
        throw new Error('Укажите корректный номер телефона (не менее 10 цифр)');
      }

      const endpoint = isLoyaltyOnly ? '/api/consents/loyalty' : '/api/consents';
      const body = isLoyaltyOnly
        ? { phone, method }
        : {
            phone,
            method,
            purposes: ['quality_control', 'ai_analysis', 'loyalty_program'],
          };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': userRole,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Ошибка сохранения согласия: HTTP ${res.status}`);
      }

      const data = await res.json();
      onConsentCreated(data.consent || data);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Ошибка оформления согласия');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-100 text-emerald-700 rounded-lg">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm">
                Регистрация согласия (152-ФЗ)
              </h3>
              <p className="text-[11px] text-slate-500">
                Оформление согласия на обработку ПДн и программу лояльности
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Номер телефона клиента
            </label>
            <input
              type="text"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+7 (999) 123-45-67"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-emerald-500 text-xs font-mono"
            />
            <p className="text-[11px] text-slate-400 mt-1">
              * Номер хранится в зашифрованном виде, в интерфейсе маскируется как ****1234
            </p>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1.5">
              Способ фиксации согласия
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMethod('written')}
                className={`p-2.5 border rounded-xl flex items-center gap-2 text-left transition-all ${
                  method === 'written'
                    ? 'border-emerald-600 bg-emerald-50/50 text-emerald-950 ring-1 ring-emerald-500'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <FileText className="w-4 h-4 text-emerald-600 shrink-0" />
                <div>
                  <div className="font-bold text-[11px]">Письменное</div>
                  <div className="text-[10px] text-slate-400">Бланк с подписью</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setMethod('digital')}
                className={`p-2.5 border rounded-xl flex items-center gap-2 text-left transition-all ${
                  method === 'digital'
                    ? 'border-emerald-600 bg-emerald-50/50 text-emerald-950 ring-1 ring-emerald-500'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Smartphone className="w-4 h-4 text-emerald-600 shrink-0" />
                <div>
                  <div className="font-bold text-[11px]">Электронное</div>
                  <div className="text-[10px] text-slate-400">SMS / Личный кабинет</div>
                </div>
              </button>
            </div>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
            <div className="font-semibold text-slate-700 text-[11px]">
              Цели обработки данных:
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isLoyaltyOnly}
                onChange={(e) => setIsLoyaltyOnly(e.target.checked)}
                className="w-4 h-4 text-emerald-600 rounded"
              />
              <span className="text-slate-700 text-[11px]">
                Программа лояльности салона «Лик 28» (loyalty_program)
              </span>
            </label>
            <div className="text-[10px] text-slate-500 pl-6">
              Контроль качества и ИИ-анализ регистрируются автоматически по аудиосогласию. Данная форма добавляет специальную цель программы лояльности.
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {loading ? 'Регистрация...' : 'Зарегистрировать согласие'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
