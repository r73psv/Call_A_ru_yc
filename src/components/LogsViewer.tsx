/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { LogEntry } from '../types';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, Trash2, ShieldCheck, Database, Bot, Mic } from 'lucide-react';

interface LogsViewerProps {
  logs: LogEntry[];
  onClearLogs?: () => void;
}

export const LogsViewer: React.FC<LogsViewerProps> = ({ logs, onClearLogs }) => {
  const getTypeIcon = (type: LogEntry['type']) => {
    switch (type) {
      case 'success':
        return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />;
      default:
        return <Info className="w-4 h-4 text-slate-400 shrink-0" />;
    }
  };

  const getModuleBadgeColor = (mod: string) => {
    switch (mod) {
      case 'speechkit':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'gigachat':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      case 'consent':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'cleanup':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'security':
        return 'bg-indigo-100 text-indigo-800 border-indigo-200';
      case 'megafon':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'vk':
        return 'bg-sky-100 text-sky-800 border-sky-200';
      case 'yclients':
        return 'bg-amber-100 text-amber-800 border-amber-200';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  const formatLogTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
    } catch {
      return isoString;
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden flex flex-col h-[600px]">
      <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-indigo-600" />
          <h2 className="font-semibold text-slate-800">Журнал операций и безопасности (152-ФЗ)</h2>
          <span className="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full font-medium">
            {logs.length}
          </span>
        </div>
        {onClearLogs && (
          <button
            onClick={onClearLogs}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors border border-slate-200 hover:border-rose-200"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Очистить журнал
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 divide-y divide-slate-100">
        {logs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 py-12">
            <Info className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">Записей в журнале пока нет</p>
          </div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="py-2.5 first:pt-0 last:pb-0 flex items-start gap-3 text-xs">
              <div className="mt-0.5">{getTypeIcon(log.type)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-mono text-slate-400 text-[11px]">{formatLogTime(log.timestamp)}</span>
                  <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold tracking-wide uppercase ${getModuleBadgeColor(log.module)}`}>
                    {log.module}
                  </span>
                </div>
                <div className="text-slate-700 font-medium break-words leading-relaxed">{log.message}</div>
                {log.details && (
                  <pre className="mt-1.5 p-2 bg-slate-50 border border-slate-200 rounded text-[11px] font-mono text-slate-600 overflow-x-auto whitespace-pre-wrap">
                    {log.details}
                  </pre>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
