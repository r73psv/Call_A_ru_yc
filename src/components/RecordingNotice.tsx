/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { ShieldAlert, Info, Mic } from 'lucide-react';

export const RecordingNotice: React.FC = () => {
  return (
    <div className="bg-gradient-to-r from-emerald-50 via-teal-50 to-blue-50 border border-emerald-200/80 rounded-xl p-3.5 shadow-2xs flex items-start gap-3 text-xs text-slate-700">
      <div className="p-1.5 bg-emerald-100/70 text-emerald-700 rounded-lg shrink-0 mt-0.5">
        <Mic className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-semibold text-emerald-950">
            Соответствие 152-ФЗ «О персональных данных»
          </span>
          <span className="px-2 py-0.2 bg-emerald-200/60 text-emerald-900 rounded-full font-medium text-[10px]">
            Автоинформатор АТС
          </span>
        </div>
        <p className="text-slate-600 leading-relaxed text-[11px]">
          При каждом входящем звонке воспроизводится предупреждение: <i>«В целях повышения качества обслуживания и работы салона красоты „Лик 28“ все разговоры записываются»</i>. Продолжение диалога фиксирует голосовое согласие клиента в зашифрованном реестре.
        </p>
      </div>
    </div>
  );
};
