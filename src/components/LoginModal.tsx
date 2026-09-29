/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Lock, User, KeyRound, ShieldCheck, AlertCircle, Sparkles, LogIn } from 'lucide-react';
import { UserRole } from '../types.js';

interface LoginModalProps {
  onLoginSuccess: (user: { id: string; username: string; name: string; role: UserRole }, token: string) => void;
  isOpen: boolean;
  onOpenChangePassword?: () => void;
}

export function LoginModal({ onLoginSuccess, isOpen, onOpenChangePassword }: LoginModalProps) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Ошибка авторизации');
      }

      localStorage.setItem('callqa_auth_token', data.token);
      localStorage.setItem('callqa_user_role', data.user.role);
      localStorage.setItem('callqa_user_info', JSON.stringify(data.user));

      onLoginSuccess(data.user, data.token);
    } catch (err: any) {
      setError(err.message || 'Не удалось выполнить вход');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickFill = (u: string, p: string) => {
    setUsername(u);
    setPassword(p);
    setError(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4" id="login-modal-overlay">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200" id="login-modal-card">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-700 to-teal-800 p-6 text-white text-center relative">
          <div className="mx-auto w-12 h-12 bg-white/10 rounded-2xl flex items-center justify-center mb-3 shadow-inner">
            <Lock className="w-6 h-6 text-emerald-200" />
          </div>
          <h2 className="text-lg font-bold tracking-tight">Вход в систему Remix CallQA</h2>
          <p className="text-xs text-emerald-100/90 mt-1">
            Салон красоты «Лик 28» • Защита ПДн по 152-ФЗ
          </p>
          <div className="inline-flex items-center gap-1.5 bg-emerald-900/50 px-2.5 py-1 rounded-full text-[11px] font-medium text-emerald-200 mt-3 border border-emerald-500/30">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            Ролевая модель доступа & Шифрование AES-256
          </div>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4" id="login-form">
          {error && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-rose-800" id="login-error-alert">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Имя пользователя (Логин)
            </label>
            <div className="relative">
              <User className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-hidden transition-all"
                placeholder="admin / manager / operator / viewer"
                id="login-username-input"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Пароль
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-hidden transition-all"
                placeholder="Введите ваш пароль"
                id="login-password-input"
              />
            </div>
            {onOpenChangePassword && (
              <div className="flex items-center justify-end mt-1.5">
                <button
                  type="button"
                  onClick={onOpenChangePassword}
                  className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 hover:underline flex items-center gap-1"
                  id="login-modal-change-password-link"
                >
                  <KeyRound className="w-3 h-3" />
                  Сменить свой пароль
                </button>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2"
            id="login-submit-button"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Проверка доступа...
              </span>
            ) : (
              <>
                <LogIn className="w-4 h-4" /> Войти в систему
              </>
            )}
          </button>
        </form>

        {/* Quick Demo Credentials Preset */}
        <div className="bg-slate-50 border-t border-slate-200/80 p-4 text-xs text-slate-600">
          <div className="flex items-center gap-1.5 font-bold text-slate-700 mb-2">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            Быстрый вход для проверки ролей (кликните для автозаполнения):
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => handleQuickFill('admin', 'admin123')}
              className="p-2 bg-white hover:bg-emerald-50 hover:border-emerald-300 border border-slate-200 rounded-lg text-left transition-colors"
            >
              <div className="font-bold text-slate-800">👑 Администратор</div>
              <div className="text-slate-500">admin / admin123</div>
              <div className="text-[10px] text-emerald-700">Полный доступ + Админка</div>
            </button>

            <button
              type="button"
              onClick={() => handleQuickFill('manager', 'manager123')}
              className="p-2 bg-white hover:bg-blue-50 hover:border-blue-300 border border-slate-200 rounded-lg text-left transition-colors"
            >
              <div className="font-bold text-slate-800">👔 Управляющий</div>
              <div className="text-slate-500">manager / manager123</div>
              <div className="text-[10px] text-blue-700">Контроль качества & ПДн</div>
            </button>

            <button
              type="button"
              onClick={() => handleQuickFill('operator', 'operator123')}
              className="p-2 bg-white hover:bg-purple-50 hover:border-purple-300 border border-slate-200 rounded-lg text-left transition-colors"
            >
              <div className="font-bold text-slate-800">🎧 Администратор ресепшн</div>
              <div className="text-slate-500">operator / operator123</div>
              <div className="text-[10px] text-purple-700">Звонки и стандарты речи</div>
            </button>

            <button
              type="button"
              onClick={() => handleQuickFill('viewer', 'viewer123')}
              className="p-2 bg-white hover:bg-slate-100 hover:border-slate-300 border border-slate-200 rounded-lg text-left transition-colors"
            >
              <div className="font-bold text-slate-800">👁️ Аудитор / Наблюдатель</div>
              <div className="text-slate-500">viewer / viewer123</div>
              <div className="text-[10px] text-slate-600">Обезличенные отчеты</div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
