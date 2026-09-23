/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Lock, KeyRound, ShieldAlert, AlertCircle, X } from 'lucide-react';

interface AdminPasswordPromptModalProps {
  isOpen: boolean;
  onSuccess: () => void;
  onCancel: () => void;
  authToken?: string | null;
}

export function AdminPasswordPromptModal({
  isOpen,
  onSuccess,
  onCancel,
  authToken,
}: AdminPasswordPromptModalProps) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const res = await fetch('/api/auth/verify-admin-password', {
        method: 'POST',
        headers,
        body: JSON.stringify({ password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Неверный пароль администратора');
      }

      setPassword('');
      onSuccess();
    } catch (err: any) {
      setError(err.message || 'Ошибка проверки пароля');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4" id="admin-auth-gate-modal">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-5 text-white flex justify-between items-start">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/20 text-amber-400 rounded-xl border border-amber-500/30">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-tight">Защищенная панель администратора</h3>
              <p className="text-[11px] text-slate-300">Требуется подтверждение мастер-пароля</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4" id="admin-verify-password-form">
          <p className="text-xs text-slate-600 leading-relaxed">
            Вход в админ-панель открывает доступ к управлению системными токенами, ключами Yandex SpeechKit, GigaChat, S3 и правами доступа сотрудников салона «Лик 28».
          </p>

          {error && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-rose-800" id="admin-gate-error">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1.5">
              Мастер-пароль администратора
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoFocus
                className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-amber-500 focus:bg-white focus:outline-hidden transition-all"
                placeholder="По умолчанию: admin123"
                id="admin-verify-password-input"
              />
            </div>
            <p className="text-[10px] text-slate-400 mt-1">Пароль по умолчанию для демо: admin123</p>
          </div>

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-400 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2"
              id="admin-verify-password-submit"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Проверка...
                </span>
              ) : (
                <>
                  <Lock className="w-3.5 h-3.5" /> Подтвердить вход
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
