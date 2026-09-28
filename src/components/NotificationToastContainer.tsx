/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Sparkles, AlertTriangle, CheckCircle2, PhoneMissed, 
  ExternalLink, X, User, Phone, Star, ShieldAlert,
  Volume2, VolumeX, ArrowRight
} from 'lucide-react';
import { SystemNotification, UserRole } from '../types.js';

interface NotificationToastContainerProps {
  userRole: UserRole;
  authToken?: string | null;
  onSelectCall: (callId: string) => void;
  onNewNotification?: (notification: SystemNotification) => void;
  soundEnabled: boolean;
}

interface ActiveToast {
  notification: SystemNotification;
  remainingMs: number;
  totalMs: number;
  isPaused: boolean;
  intervalId?: any;
}

// Subtle Web Audio chime without external assets
export function playNotificationSound(isDispute = false) {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;
    if (isDispute) {
      // Alert chime for dispute/complaint
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(493.88, now); // B4
      osc.frequency.exponentialRampToValueAtTime(392.00, now + 0.12); // G4
      osc.frequency.exponentialRampToValueAtTime(587.33, now + 0.28); // D5
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.55);
    } else {
      // Pleasant harmonic double chime for successful call analysis
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(523.25, now); // C5
      gain1.gain.setValueAtTime(0.14, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.28);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(783.99, now + 0.09); // G5
      gain2.gain.setValueAtTime(0.14, now + 0.09);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.09);
      osc2.stop(now + 0.48);
    }
  } catch {
    // Autoplay policy fallback
  }
}

export function NotificationToastContainer({
  userRole,
  authToken,
  onSelectCall,
  onNewNotification,
  soundEnabled
}: NotificationToastContainerProps) {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  const isAuthorized = userRole === 'admin' || userRole === 'manager';
  const seenNotificationIds = useRef<Set<string>>(new Set());
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.notification.id !== id));
  }, []);

  const addToast = useCallback((notification: SystemNotification) => {
    if (seenNotificationIds.current.has(notification.id)) {
      return;
    }
    seenNotificationIds.current.add(notification.id);

    // Play chime if enabled
    if (soundEnabledRef.current) {
      playNotificationSound(!!notification.is_dispute);
    }

    if (onNewNotification) {
      onNewNotification(notification);
    }

    const durationMs = notification.is_dispute ? 9000 : 7000;
    const newToast: ActiveToast = {
      notification,
      remainingMs: durationMs,
      totalMs: durationMs,
      isPaused: false
    };

    setToasts(prev => [newToast, ...prev.slice(0, 2)]);
  }, [onNewNotification]);

  // Tick timers for toasts
  useEffect(() => {
    if (toasts.length === 0) return;

    const interval = setInterval(() => {
      setToasts(prev => {
        let changed = false;
        const updated = prev.map(t => {
          if (t.isPaused) return t;
          const nextRemaining = t.remainingMs - 100;
          changed = true;
          return { ...t, remainingMs: nextRemaining };
        }).filter(t => t.remainingMs > 0);

        return changed ? updated : prev;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [toasts.length]);

  // Connect to SSE stream for real-time notifications
  useEffect(() => {
    if (!isAuthorized) {
      setToasts([]);
      return;
    }

    let eventSource: EventSource | null = null;
    let reconnectTimeout: any = null;
    let isUnmounted = false;

    const connectSSE = () => {
      if (isUnmounted) return;
      try {
        const streamUrl = `/api/notifications/stream?role=${encodeURIComponent(userRole)}`;
        eventSource = new EventSource(streamUrl);

        eventSource.addEventListener('notification', (e: MessageEvent) => {
          try {
            const data: SystemNotification = JSON.parse(e.data);
            addToast(data);
          } catch (err: any) {
            console.warn('Failed to parse SSE notification payload:', err?.message || err);
          }
        });

        eventSource.onerror = () => {
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }
          if (!isUnmounted) {
            reconnectTimeout = setTimeout(connectSSE, 4000);
          }
        };
      } catch (err) {
        if (!isUnmounted) {
          reconnectTimeout = setTimeout(connectSSE, 5000);
        }
      }
    };

    connectSSE();

    return () => {
      isUnmounted = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [isAuthorized, userRole, addToast]);

  const handleMouseEnter = (id: string) => {
    setToasts(prev => prev.map(t => t.notification.id === id ? { ...t, isPaused: true } : t));
  };

  const handleMouseLeave = (id: string) => {
    setToasts(prev => prev.map(t => t.notification.id === id ? { ...t, isPaused: false } : t));
  };

  const handleToastClick = (toast: ActiveToast) => {
    dismissToast(toast.notification.id);
    onSelectCall(toast.notification.call_id);
  };

  if (!isAuthorized || toasts.length === 0) {
    return null;
  }

  return (
    <div 
      className="fixed bottom-5 right-5 z-[9999] flex flex-col-reverse gap-3 max-w-md w-full pointer-events-none px-4 sm:px-0"
      aria-live="polite"
      role="region"
      aria-label="Всплывающие уведомления анализа звонков"
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => {
          const { notification, remainingMs, totalMs } = toast;
          const progressPercent = Math.max(0, Math.min(100, (remainingMs / totalMs) * 100));
          const isDispute = !!notification.is_dispute;
          const isBooking = notification.booking_status === 'согласие' || notification.type === 'booking_confirmed';
          const isFailed = notification.type === 'call_failed';
          const isMissed = notification.type === 'call_analyzed' && notification.title.includes('Пропущенный');

          // Tone & styling based on call outcome
          let borderColor = 'border-blue-500/40 hover:border-blue-400';
          let shadowColor = 'shadow-[0_10px_30px_rgba(37,99,235,0.25)]';
          let iconBg = 'bg-blue-500/20 text-blue-400 border border-blue-500/30';
          let IconComponent = Sparkles;

          if (isDispute) {
            borderColor = 'border-rose-500/60 hover:border-rose-400';
            shadowColor = 'shadow-[0_10px_35px_rgba(244,63,94,0.35)]';
            iconBg = 'bg-rose-500/25 text-rose-400 border border-rose-500/40 animate-pulse';
            IconComponent = AlertTriangle;
          } else if (isBooking) {
            borderColor = 'border-emerald-500/50 hover:border-emerald-400';
            shadowColor = 'shadow-[0_10px_30px_rgba(16,185,129,0.25)]';
            iconBg = 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30';
            IconComponent = CheckCircle2;
          } else if (isFailed || isMissed) {
            borderColor = 'border-amber-500/50 hover:border-amber-400';
            shadowColor = 'shadow-[0_10px_30px_rgba(245,158,11,0.25)]';
            iconBg = 'bg-amber-500/20 text-amber-400 border border-amber-500/30';
            IconComponent = PhoneMissed;
          }

          return (
            <motion.div
              key={notification.id}
              layout
              initial={{ opacity: 0, y: 30, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, y: 15 }}
              transition={{ duration: 0.24, ease: 'easeOut' }}
              onMouseEnter={() => handleMouseEnter(notification.id)}
              onMouseLeave={() => handleMouseLeave(notification.id)}
              className={`pointer-events-auto relative overflow-hidden rounded-xl bg-slate-900/95 backdrop-blur-md border ${borderColor} ${shadowColor} text-slate-100 transition-colors p-4 cursor-pointer group`}
              onClick={() => handleToastClick(toast)}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`p-2 rounded-lg shrink-0 ${iconBg}`}>
                    <IconComponent className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-slate-100 tracking-tight truncate">
                        {notification.title}
                      </span>
                      {notification.model_used && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700 font-mono">
                          {notification.model_used}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-400">
                      Только что • API АТС
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    dismissToast(notification.id);
                  }}
                  className="text-slate-400 hover:text-slate-100 p-1 -mr-1 -mt-1 rounded-md hover:bg-slate-800 transition-colors shrink-0"
                  title="Закрыть уведомление"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Call Details Summary */}
              <div className="bg-slate-950/60 rounded-lg p-2.5 border border-slate-800/80 mb-2.5 text-xs space-y-1.5">
                <div className="flex items-center justify-between text-slate-300">
                  <div className="flex items-center gap-1.5 truncate">
                    <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="font-medium truncate">{notification.client_name}</span>
                    {notification.client_phone_masked && (
                      <span className="text-slate-500 font-mono text-[11px]">
                        ({notification.client_phone_masked})
                      </span>
                    )}
                  </div>

                  {notification.operator_score !== null && notification.operator_score !== undefined && (
                    <div className={`flex items-center gap-1 font-bold text-xs px-2 py-0.5 rounded-full shrink-0 ${
                      notification.operator_score >= 8 
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                        : notification.operator_score >= 5 
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' 
                        : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                    }`}>
                      <Star className="w-3 h-3 fill-current" />
                      <span>{notification.operator_score}/10</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between text-slate-400 text-[11px]">
                  <span className="truncate">
                    Оператор: <strong className="text-slate-300 font-normal">{notification.operator_name}</strong>
                  </span>
                  {notification.booking_status && (
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 uppercase tracking-wider ${
                      notification.booking_status === 'согласие' 
                        ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' 
                        : notification.booking_status === 'отказ'
                        ? 'bg-rose-950 text-rose-300 border border-rose-800'
                        : 'bg-slate-800 text-slate-300'
                    }`}>
                      Запись: {notification.booking_status}
                    </span>
                  )}
                </div>

                {isDispute && (
                  <div className="flex items-center gap-1.5 text-rose-300 bg-rose-950/50 px-2 py-1 rounded border border-rose-800/60 font-medium text-[11px]">
                    <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    <span>Внимание: зафиксирован конфликт или жалоба клиента!</span>
                  </div>
                )}

                {notification.message && (
                  <p className="text-slate-300 text-xs line-clamp-2 leading-relaxed pt-0.5">
                    {notification.message}
                  </p>
                )}
              </div>

              {/* Action row */}
              <div className="flex items-center justify-between text-xs pt-0.5">
                <span className="text-[11px] text-slate-400 group-hover:text-blue-400 transition-colors flex items-center gap-1 font-medium">
                  Нажмите, чтобы открыть звонок
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  {notification.call_id}
                </span>
              </div>

              {/* Progress timer bar */}
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-800/80">
                <div 
                  className={`h-full transition-all duration-100 ease-linear ${
                    isDispute ? 'bg-rose-500' : isBooking ? 'bg-emerald-500' : 'bg-blue-500'
                  }`}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
