/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { RefreshCw, Bot, ChevronDown, Check } from 'lucide-react';
import { GigaChatModel, CallRecord } from '../types.js';

interface ReanalyzeButtonProps {
  callId: string;
  currentModel?: string;
  onReanalyzed: (updatedCall: CallRecord) => void;
  userRole?: string;
}

export const ReanalyzeButton: React.FC<ReanalyzeButtonProps> = ({
  callId,
  currentModel = 'GigaChat:Lite',
  onReanalyzed,
  userRole = 'admin',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<GigaChatModel>(
    (currentModel.startsWith('GigaChat:') ? currentModel : 'GigaChat:Lite') as GigaChatModel
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const models: { id: GigaChatModel; label: string; desc: string }[] = [
    { id: 'GigaChat:Lite', label: 'Lite (Базовая)', desc: 'Быстрый анализ' },
    { id: 'GigaChat:Pro', label: 'Pro (Сложные диалоги)', desc: 'Глубокий разбор конфликтов' },
    { id: 'GigaChat:Max', label: 'Max (Флагман)', desc: 'Максимальная точность' },
    { id: 'GigaChat:Ultra', label: 'Ultra (Reasoning)', desc: 'Глубокое рассуждение и аналитика' },
  ];

  const handleReanalyze = async (modelToUse: GigaChatModel) => {
    setLoading(true);
    setError(null);
    setIsOpen(false);

    try {
      const res = await fetch(`/api/calls/${callId}/reanalyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-role': userRole,
        },
        body: JSON.stringify({ model: modelToUse }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Ошибка сервера: HTTP ${res.status}`);
      }

      const updated = await res.json();
      onReanalyzed(updated);
    } catch (err: any) {
      setError(err.message || 'Ошибка повторного анализа');
    } finally {
      setLoading(false);
    }
  };

  if (userRole === 'viewer') {
    return null;
  }

  return (
    <div className="relative inline-block text-left">
      <div className="inline-flex rounded-lg shadow-2xs">
        <button
          type="button"
          onClick={() => handleReanalyze(selectedModel)}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-l-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Анализ...' : `Пересчитать (${selectedModel.replace('GigaChat:', '')})`}
        </button>

        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          disabled={loading}
          className="px-2 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-r-lg border-l border-emerald-500 transition-colors disabled:opacity-50"
          title="Выбрать модель GigaChat"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-20"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-1.5 w-60 bg-white rounded-xl shadow-xl border border-slate-200 z-30 py-1.5 overflow-hidden">
            <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-100">
              Модель анализа GigaChat
            </div>
            {models.map((m) => {
              const isCurrent = selectedModel === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setSelectedModel(m.id);
                    handleReanalyze(m.id);
                  }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-slate-50 flex items-start justify-between gap-2 transition-colors"
                >
                  <div>
                    <div className="font-semibold text-slate-800 flex items-center gap-1.5">
                      {m.label}
                      {isCurrent && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{m.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {error && (
        <div className="text-[11px] text-rose-600 mt-1 font-medium">
          {error}
        </div>
      )}
    </div>
  );
};
