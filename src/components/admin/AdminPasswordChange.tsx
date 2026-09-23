/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { KeyRound, Lock, ShieldCheck, AlertCircle, CheckCircle2 } from 'lucide-react';

interface AdminPasswordChangeProps {
  authToken?: string | null;
  adminUsername?: string;
}

export function AdminPasswordChange({ authToken, adminUsername = 'admin' }: AdminPasswordChangeProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const getHeaders = () => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) h['Authorization'] = `Bearer ${authToken}`;
    return h;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (newPassword.length < 6) {
      setError('Новый пароль должен содержать минимум 6 символов');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Новые пароли не совпадают');
      return;
    }

    setLoading(true);
    try {
      // 1. First verify current admin password
      const verifyRes = await fetch('/api/auth/verify-admin-password', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ password: currentPassword }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) {
        throw new Error(verifyData.error || 'Неверный текущий пароль');
      }

      // 2. Find admin user ID to update password
      const usersRes = await fetch('/api/admin/users', { headers: getHeaders() });
      if (!usersRes.ok) throw new Error('Не удалось получить список пользователей');
      const users = await usersRes.json();
      const adminUser = users.find((u: any) => u.role === 'admin' && u.username === adminUsername) ||
        users.find((u: any) => u.role === 'admin');

      if (!adminUser) throw new Error('Администратор не найден в системе');

      // 3. Update password
      const updateRes = await fetch(`/api/admin/users/${adminUser.id}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ password: newPassword }),
      });
      const updateData = await updateRes.json();
      if (!updateRes.ok) throw new Error(updateData.error || 'Не удалось обновить пароль');

      setSuccess('Мастер-пароль администратора успешно изменен!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto bg-white p-6 rounded-2xl border border-slate-200 shadow-2xs space-y-5" id="admin-password-change-section">
      <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
        <div className="p-2.5 bg-amber-50 text-amber-700 rounded-xl">
          <KeyRound className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-bold text-slate-900 text-sm">Смена мастер-пароля администратора</h3>
          <p className="text-xs text-slate-500">Защита доступа к критическим настройкам и токенам</p>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-rose-800">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-emerald-800">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <span>{success}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            Текущий пароль администратора*
          </label>
          <input
            type="password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Введите текущий пароль (по умолчанию admin123)"
            className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-amber-500 focus:bg-white focus:outline-hidden"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            Новый пароль (не менее 6 знаков)*
          </label>
          <input
            type="password"
            required
            minLength={6}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Задайте надежный новый пароль"
            className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-amber-500 focus:bg-white focus:outline-hidden"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-700 mb-1.5">
            Подтвердите новый пароль*
          </label>
          <input
            type="password"
            required
            minLength={6}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Повторите новый пароль"
            className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-amber-500 focus:bg-white focus:outline-hidden"
          />
        </div>

        <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 text-[11px] text-slate-600 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>Пароль сохраняется в виде криптографического хэша PBKDF2 (SHA-512, 100 000 итераций) с индивидуальной солью.</span>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 disabled:bg-slate-400 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2"
        >
          <Lock className="w-4 h-4" />
          {loading ? 'Обновление пароля...' : 'Сменить пароль администратора'}
        </button>
      </form>
    </div>
  );
}
