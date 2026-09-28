/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Bell, Check, Trash2, Volume2, VolumeX, Sparkles, 
  AlertTriangle, CheckCircle2, PhoneMissed, Star,
  ExternalLink, Play, ShieldAlert, ArrowRight
} from 'lucide-react';
import { SystemNotification, UserRole } from '../types.js';

interface NotificationsBellProps {
  userRole: UserRole;
  authToken?: string | null;
  onSelectCall: (callId: string) => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
}

export function NotificationsBell({
  userRole,
  authToken,
  onSelectCall,
  soundEnabled,
  onToggleSound
}: NotificationsBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<SystemNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isAuthorized = userRole === 'admin' || userRole === 'manager';
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchNotifications = async (retries = 2) => {
    if (!isAuthorized || !isMountedRef.current) return;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (!isMountedRef.current) return;
      try {
        const headers: Record<string, string> = { 'x-user-role': userRole };
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        const res = await fetch(`/api/notifications?role=${encodeURIComponent(userRole)}`, {
          headers,
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const text = await res.text();
          if (text && !text.trim().startsWith('<')) {
            const data = JSON.parse(text);
            if (isMountedRef.current) {
              setNotifications(Array.isArray(data) ? data : []);
            }
            return;
          }
        }
      } catch (err: any) {
        if (!isMountedRef.current) return;
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
          continue;
        }
        // Soft warning for network glitch or server restart without throwing console.error
        console.warn('Notifications background fetch temporarily unavailable:', err?.message || err);
      }
    }
  };

  useEffect(() => {
    if (!isAuthorized) return;
    fetchNotifications();
    const interval = setInterval(() => {
      fetchNotifications(1);
    }, 10000);
    return () => clearInterval(interval);
  }, [isAuthorized, userRole, authToken]);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const handleMarkAllRead = async () => {
    try {
      const headers: Record<string, string> = { 'x-user-role': userRole };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      await fetch('/api/notifications/read-all', { method: 'POST', headers });
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    } catch {}
  };

  const handleClearAll = async () => {
    try {
      const headers: Record<string, string> = { 'x-user-role': userRole };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      await fetch('/api/notifications/clear', { method: 'DELETE', headers });
      setNotifications([]);
    } catch {}
  };

  const handleSendTestNotification = async () => {
    setTestSending(true);
    try {
      const headers: Record<string, string> = { 
        'x-user-role': userRole,
        'Content-Type': 'application/json'
      };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch('/api/notifications/test', { method: 'POST', headers });
      if (res.ok) {
        await fetchNotifications();
      }
    } catch (err: any) {
      console.warn('Test notification failed:', err?.message || err);
    } finally {
      setTestSending(false);
    }
  };

  const handleNotificationClick = async (notif: SystemNotification) => {
    if (!notif.read) {
      try {
        const headers: Record<string, string> = { 'x-user-role': userRole };
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
        await fetch(`/api/notifications/${notif.id}/read`, { method: 'POST', headers });
        setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n));
      } catch {}
    }
    setIsOpen(false);
    onSelectCall(notif.call_id);
  };

  if (!isAuthorized) {
    return null;
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Trigger Button */}
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) fetchNotifications();
        }}
        className={`relative p-2 rounded-lg border transition-all flex items-center justify-center ${
          isOpen
            ? 'bg-blue-600/20 text-blue-400 border-blue-500/50 shadow-[0_0_12px_rgba(59,130,246,0.3)]'
            : 'bg-slate-800/80 text-slate-300 border-slate-700/80 hover:bg-slate-700 hover:text-white hover:border-slate-600'
        }`}
        title="Уведомления о завершении анализа звонков"
        aria-label="Уведомления"
        aria-expanded={isOpen}
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold text-white shadow-sm ring-2 ring-slate-900 animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Notifications Dropdown Panel */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl z-50 overflow-hidden flex flex-col text-slate-200">
          {/* Header */}
          <div className="p-3 bg-slate-950/70 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-blue-500/20 text-blue-400">
                <Bell className="w-3.5 h-3.5" />
              </div>
              <span className="font-semibold text-xs text-slate-100">
                Уведомления анализа звонков
              </span>
              {unreadCount > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 font-medium">
                  {unreadCount} новых
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {/* Sound Toggle */}
              <button
                type="button"
                onClick={onToggleSound}
                className={`p-1.5 rounded-md transition-colors ${
                  soundEnabled 
                    ? 'text-slate-300 hover:text-white hover:bg-slate-800' 
                    : 'text-slate-500 hover:text-slate-400 hover:bg-slate-800'
                }`}
                title={soundEnabled ? 'Звуковые оповещения включены (нажмите для выключения)' : 'Звуковые оповещения выключены'}
              >
                {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5 text-rose-400" />}
              </button>

              {/* Mark All Read */}
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="p-1.5 text-slate-400 hover:text-emerald-400 rounded-md hover:bg-slate-800 transition-colors"
                  title="Отметить все прочитанными"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Clear All */}
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="p-1.5 text-slate-400 hover:text-rose-400 rounded-md hover:bg-slate-800 transition-colors"
                  title="Очистить историю уведомлений"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Quick Actions Bar */}
          <div className="px-3 py-1.5 bg-slate-900/90 border-b border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
            <span>Анализ входящих звонков по API</span>
            <button
              type="button"
              disabled={testSending}
              onClick={handleSendTestNotification}
              className="text-blue-400 hover:text-blue-300 font-medium transition-colors flex items-center gap-1 disabled:opacity-50"
            >
              <Sparkles className="w-3 h-3" />
              {testSending ? 'Отправка...' : 'Тест Toast'}
            </button>
          </div>

          {/* Notifications Scrollable List */}
          <div className="max-h-96 overflow-y-auto divide-y divide-slate-800/60 p-1">
            {notifications.length === 0 ? (
              <div className="py-8 px-4 text-center">
                <Bell className="w-8 h-8 text-slate-600 mx-auto mb-2 opacity-50" />
                <p className="text-xs text-slate-400 font-medium">Нет новых уведомлений</p>
                <p className="text-[11px] text-slate-500 mt-1 max-w-[220px] mx-auto">
                  Здесь будут всплывать уведомления при завершении ИИ-анализа звонков, поступающих через API.
                </p>
                <button
                  type="button"
                  onClick={handleSendTestNotification}
                  disabled={testSending}
                  className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-blue-400 font-medium transition-colors"
                >
                  <Play className="w-3 h-3" />
                  Сгенерировать тест
                </button>
              </div>
            ) : (
              notifications.map((notif) => {
                const isDispute = !!notif.is_dispute;
                const isBooking = notif.booking_status === 'согласие' || notif.type === 'booking_confirmed';
                const timeAgo = formatTimeAgo(notif.timestamp);

                return (
                  <div
                    key={notif.id}
                    onClick={() => handleNotificationClick(notif)}
                    className={`p-2.5 rounded-lg transition-colors cursor-pointer group flex flex-col gap-1.5 ${
                      notif.read 
                        ? 'hover:bg-slate-800/40 text-slate-400' 
                        : 'bg-blue-950/20 hover:bg-blue-950/30 text-slate-200 border-l-2 border-blue-500'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {isDispute ? (
                          <div className="p-1 rounded bg-rose-500/20 text-rose-400">
                            <AlertTriangle className="w-3.5 h-3.5" />
                          </div>
                        ) : isBooking ? (
                          <div className="p-1 rounded bg-emerald-500/20 text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </div>
                        ) : (
                          <div className="p-1 rounded bg-blue-500/20 text-blue-400">
                            <Sparkles className="w-3.5 h-3.5" />
                          </div>
                        )}
                        <span className={`text-xs font-medium truncate ${!notif.read ? 'text-slate-100 font-semibold' : ''}`}>
                          {notif.title}
                        </span>
                      </div>

                      <span className="text-[10px] text-slate-500 shrink-0 font-mono">
                        {timeAgo}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-300 flex items-center justify-between">
                      <span className="truncate">
                        Клиент: <strong className="text-slate-200 font-medium">{notif.client_name}</strong>
                      </span>
                      {notif.operator_score !== null && notif.operator_score !== undefined && (
                        <span className={`px-1.5 py-0.2 rounded font-bold text-[10px] shrink-0 ${
                          notif.operator_score >= 8 
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' 
                            : notif.operator_score >= 5 
                            ? 'bg-amber-950 text-amber-300 border border-amber-800' 
                            : 'bg-rose-950 text-rose-300 border border-rose-800'
                        }`}>
                          {notif.operator_score}/10
                        </span>
                      )}
                    </div>

                    {isDispute && (
                      <div className="flex items-center gap-1 text-[10px] text-rose-400 bg-rose-950/40 px-1.5 py-0.5 rounded">
                        <ShieldAlert className="w-3 h-3 shrink-0" />
                        <span>Конфликт/претензия зафиксированы</span>
                      </div>
                    )}

                    {notif.message && (
                      <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                        {notif.message}
                      </p>
                    )}

                    <div className="flex items-center justify-between pt-0.5 text-[10px] text-slate-500">
                      <span className="font-mono">{notif.call_id}</span>
                      <span className="text-blue-400 group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5 font-medium">
                        Перейти
                        <ArrowRight className="w-3 h-3" />
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatTimeAgo(isoString: string): string {
  try {
    const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (diff < 60) return 'только что';
    if (diff < 3600) return `${Math.floor(diff / 60)} мин.`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} ч.`;
    return new Date(isoString).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  } catch {
    return '';
  }
}
