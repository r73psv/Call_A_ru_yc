/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Play, FileText, Phone, User, Settings2, Info, ChevronRight, Check } from 'lucide-react';

interface MegafonSimulatorProps {
  onSimulate: (data: {
    client_phone: string;
    client_name: string;
    operator_name: string;
    transcriptPresetId: string;
    duration: number;
    status: string;
  }) => Promise<void>;
  activeModel: string;
}

export function MegafonSimulator({ onSimulate, activeModel }: MegafonSimulatorProps) {
  const [clientPhone, setClientPhone] = useState('+7 (916) 555-43-21');
  const [clientName, setClientName] = useState('Алёна Рябова');
  const [operatorName, setOperatorName] = useState('Мария (администратор)');
  const [presetId, setPresetId] = useState('nails_booking');
  const [duration, setDuration] = useState(150);
  const [selectedStatus, setSelectedStatus] = useState('Success');
  const [simulating, setSimulating] = useState(false);
  const [successState, setSuccessState] = useState(false);

  const statuses = [
    { id: 'Success', label: 'Success ‑ Успешный звонок' },
    { id: 'missed', label: 'missed ‑ пропущенный звонок' },
    { id: 'Cancel', label: 'Cancel – звонок отменен' },
    { id: 'Busy', label: 'Busy – получен ответ «Занято»' },
    { id: 'NotAvailable', label: 'NotAvailable – получен ответ «Абонент недоступен»' },
    { id: 'NotAllowed', label: 'NotAllowed – получен ответ «Звонки на это направление запрещены»' },
    { id: 'NotFound', label: 'NotFound – получен ответ «Вызываемый абонент не найден, нет такого SIP номера»' }
  ];

  const presets = [
    {
      id: 'nails_booking',
      title: '💅 Запись на маникюр (Успешный)',
      description: 'Клиент бронирует время у мастера Кристины, администратор вежлива и фиксирует WhatsApp-напоминание.',
      defaultClient: 'Елена Кузнецова',
      defaultOperator: 'Мария (администратор)',
      defaultDuration: 145
    },
    {
      id: 'cancelled_dispute',
      title: '⚠️ Отмена записи (Конфликтный)',
      description: 'Администратор отменяет запись день-в-день. Клиент сердится, администратор гасит недовольство скидкой 30%.',
      defaultClient: 'Анна Васильева',
      defaultOperator: 'Дмитрий (менеджер)',
      defaultDuration: 180
    },
    {
      id: 'bad_haircut',
      title: '💇 Кривая стрижка (Жалоба/Спор)',
      description: 'Клиент жалуется на криво постриженные волосы. Администратор организует бесплатную переделку.',
      defaultClient: 'Ольга Смирнова',
      defaultOperator: 'Екатерина (администратор)',
      defaultDuration: 160
    }
  ];

  const handlePresetSelect = (id: string) => {
    setPresetId(id);
    const p = presets.find(item => item.id === id);
    if (p) {
      setClientName(p.defaultClient);
      setOperatorName(p.defaultOperator);
      setDuration(p.defaultDuration);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSimulating(true);
    await onSimulate({
      client_phone: clientPhone,
      client_name: clientName,
      operator_name: operatorName,
      transcriptPresetId: selectedStatus === 'Success' ? presetId : '',
      duration: selectedStatus === 'Success' ? duration : 0,
      status: selectedStatus
    });
    setSimulating(false);
    setSuccessState(true);
    setTimeout(() => setSuccessState(false), 3000);
  };

  return (
    <div className="bg-white border border-slate-100 rounded-2xl shadow-xs p-5 text-left space-y-4" id="megafon-simulator-panel">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <h2 className="text-sm font-bold text-slate-800 tracking-tight flex items-center gap-1.5">
          <Settings2 className="w-4.5 h-4.5 text-blue-500" /> Имитатор АТС Мегафон (REST Webhook)
        </h2>
        <span className="text-[10px] bg-blue-50 text-blue-600 px-2.5 py-1 rounded-full font-semibold">
          Активная модель: {activeModel.toUpperCase()}
        </span>
      </div>

      <div className="bg-blue-50/50 rounded-xl p-3 border border-blue-100/30 flex gap-2 text-xs text-blue-800 leading-relaxed font-normal">
        <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
        <p>
          Этот симулятор посылает тестовый REST API вебхук (с сигнатурой авторизации <code>x-megafon-signature</code>) во внутренний контроллер АТС Мегафон на сервере, запуская автоматический анализ звонка.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" id="megafon-simulator-form">
        {/* Status select field */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            Статус вызова АТС (Disposing Status)
          </label>
          <select
            id="simulator-status-select"
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="w-full text-xs bg-white border border-slate-200 rounded-xl p-2.5 font-medium text-slate-800 focus:outline-hidden focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
          >
            {statuses.map(st => (
              <option key={st.id} value={st.id}>{st.label}</option>
            ))}
          </select>
        </div>

        {/* Preset selection (only relevant if status is Success) */}
        {selectedStatus === 'Success' ? (
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
              Выберите сценарий телефонного звонка
            </label>
            <div className="space-y-2">
              {presets.map((p) => (
                <div
                  key={p.id}
                  onClick={() => handlePresetSelect(p.id)}
                  className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                    presetId === p.id 
                      ? 'border-blue-500 bg-blue-50/40 shadow-2xs' 
                      : 'border-slate-100 hover:border-slate-300 bg-slate-50/30'
                  }`}
                >
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-bold text-slate-800">{p.title}</span>
                    {presetId === p.id && <ChevronRight className="w-4 h-4 text-blue-500" />}
                  </div>
                  <p className="text-[11px] text-slate-500 font-normal leading-relaxed">{p.description}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-4 text-slate-500 text-xs">
            💡 Разговор не состоялся из-за статуса <strong>{selectedStatus}</strong>. Аудиозапись и стенограмма недоступны, анализ ИИ зафиксирует неуспешный вызов с оценкой качества 0/10 и рекомендациями по работе с базой клиентов.
          </div>
        )}

        {/* Input variables */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Имя клиента</label>
            <div className="relative">
              <User className="absolute left-2.5 top-2 text-slate-400 w-4 h-4" />
              <input
                id="simulator-client-name"
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:border-slate-400 font-normal"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Имя сотрудника</label>
            <div className="relative">
              <User className="absolute left-2.5 top-2 text-slate-400 w-4 h-4" />
              <input
                id="simulator-operator-name"
                type="text"
                value={operatorName}
                onChange={(e) => setOperatorName(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:border-slate-400 font-normal"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Номер телефона клиента</label>
            <div className="relative">
              <Phone className="absolute left-2.5 top-2 text-slate-400 w-4 h-4" />
              <input
                id="simulator-client-phone"
                type="text"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:border-slate-400 font-normal"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Длительность звонка (сек)</label>
            <input
              id="simulator-call-duration"
              type="number"
              disabled={selectedStatus !== 'Success'}
              value={selectedStatus === 'Success' ? duration : 0}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg disabled:bg-slate-50 disabled:text-slate-400 focus:outline-hidden focus:border-slate-400 font-mono font-normal"
            />
          </div>
        </div>

        {/* Submit action */}
        <button
          id="trigger-webhook-btn"
          type="submit"
          disabled={simulating}
          className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-2 shadow-sm transition-all duration-150 ${
            successState
              ? 'bg-emerald-600 hover:bg-emerald-700'
              : 'bg-blue-600 hover:bg-blue-700 hover:shadow-md'
          }`}
        >
          {successState ? (
            <>
              <Check className="w-4 h-4" /> Вебхук отправлен! Проверьте логи ниже
            </>
          ) : (
            <>
              <Play className={`w-3.5 h-3.5 ${simulating ? 'animate-pulse' : ''}`} />
              {simulating ? 'Имитация АТС и анализ ИИ...' : 'Сгенерировать & проанализировать звонок'}
            </>
          )}
        </button>
      </form>
    </div>
  );
}
