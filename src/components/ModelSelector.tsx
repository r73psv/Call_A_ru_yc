/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { GigaChatModel } from '../types.js';
import { Bot, Sparkles, Zap, Cpu } from 'lucide-react';

interface ModelSelectorProps {
  currentModel: GigaChatModel | string;
  onSelectModel: (model: GigaChatModel) => void;
  disabled?: boolean;
  compact?: boolean;
}

export const ModelSelector: React.FC<ModelSelectorProps> = ({
  currentModel,
  onSelectModel,
  disabled = false,
  compact = false,
}) => {
  const models: { id: GigaChatModel; label: string; badge: string; desc: string; icon: any }[] = [
    {
      id: 'GigaChat:Lite',
      label: 'Lite',
      badge: 'Базовая',
      desc: 'Быстрый и экономичный анализ типовых звонков и записей',
      icon: Zap,
    },
    {
      id: 'GigaChat:Pro',
      label: 'Pro',
      badge: 'Сложные диалоги',
      desc: 'Глубокий анализ претензий, конфликтов и работы оператора',
      icon: Bot,
    },
    {
      id: 'GigaChat:Max',
      label: 'Max',
      badge: 'Флагман',
      desc: 'Максимальная точность нюансов речи и сложных сценариев',
      icon: Sparkles,
    },
    {
      id: 'GigaChat:Ultra',
      label: 'Ultra',
      badge: 'Reasoning',
      desc: 'Флагман нового поколения: глубокое рассуждение и аналитика',
      icon: Cpu,
    },
  ];

  if (compact) {
    return (
      <div className="inline-flex items-center gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200">
        {models.map((m) => {
          const isSelected = currentModel === m.id;
          return (
            <button
              key={m.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelectModel(m.id)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1 ${
                isSelected
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              } disabled:opacity-50`}
            >
              <span>{m.label}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
      {models.map((m) => {
        const isSelected = currentModel === m.id;
        const Icon = m.icon;
        return (
          <button
            key={m.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelectModel(m.id)}
            className={`p-3 text-left rounded-xl border transition-all flex flex-col justify-between ${
              isSelected
                ? 'bg-emerald-50/70 border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs'
                : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
            } disabled:opacity-50`}
          >
            <div className="flex items-center justify-between mb-1.5 w-full">
              <div className="flex items-center gap-1.5">
                <Icon className={`w-4 h-4 ${isSelected ? 'text-emerald-600' : 'text-slate-500'}`} />
                <span className="font-bold text-xs text-slate-900">GigaChat {m.label}</span>
              </div>
              <span
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                  isSelected
                    ? 'bg-emerald-200 text-emerald-900'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {m.badge}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 leading-snug">{m.desc}</p>
          </button>
        );
      })}
    </div>
  );
};
