/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { KeyRound, Lock, Eye, EyeOff, ShieldCheck, CheckCircle2, AlertCircle, X, User } from 'lucide-react';
import { UserRole } from '../types.js';

interface UserPasswordChangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: {
    id: string;
    username: string;
    name: string;
    role: UserRole;
  } | null;
  authToken: string | null;
}

export function UserPasswordChangeModal({
  isOpen,
  onClose,
  currentUser,
  authToken,
}: UserPasswordChangeModalProps) {
  const [usernameInput, setUsernameInput] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (currentUser?.username) {
      setUsernameInput(currentUser.username);
    } else {
      setUsernameInput('');
    }
  }, [currentUser, isOpen]);

  if (!isOpen) return null;

  const handleReset = () => {
    if (!currentUser) setUsernameInput('');
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError(null);
    setSuccess(null);
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  const effectiveUsername = (currentUser?.username || usernameInput).trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!effectiveUsername) {
      setError('Укажите имя пользователя (логин)');
      return;
    }

    if (!currentPassword) {
      setError('Введите текущий действующий пароль');
      return;
    }

    if (!newPassword || newPassword.length < 6) {
      setError('Новый пароль должен содержать минимум 6 символов');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Новый пароль и подтверждение не совпадают');
      return;
    }

    if (currentPassword === newPassword) {
      setError('Новый пароль не должен совпадать с текущим');
      return;
    }

    setLoading(true);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      if (currentUser?.role) {
        headers['x-user-role'] = currentUser.role;
      }

      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          username: effectiveUsername,
          currentPassword,
          newPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Не удалось изменить пароль');
      }

      setSuccess('Пароль успешно изменен! Используйте новый пароль при следующем входе в систему.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');

      setTimeout(() => {
        handleClose();
      }, 2500);
    } catch (err: any) {
      setError(err.message || 'Ошибка смены пароля');
    } finally {
      setLoading(false);
    }
  };

  const getRoleLabel = (role?: UserRole) => {
    switch (role) {
      case 'admin': return 'Главный Администратор';
      case 'manager': return 'Управляющий';
      case 'operator': return 'Администратор ресепшн';
      case 'viewer': return 'Аудитор / Наблюдатель';
      default: return role || 'Пользователь';
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-200"
      id="change-password-modal-overlay"
      onClick={handleClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        id="change-password-modal-card"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-5 relative">
          <button
            type="button"
            onClick={handleClose}
            className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
            title="Закрыть"
            id="change-password-close-btn"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/20 border border-indigo-400/30 rounded-xl text-indigo-300">
              <KeyRound className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold tracking-tight text-white">
                Смена пароля пользователя
              </h3>
              <p className="text-xs text-slate-300 flex items-center gap-1.5 mt-0.5">
                {currentUser ? (
                  <>
                    <span className="font-semibold text-white">{currentUser.name}</span>
                    <span className="text-slate-400">({currentUser.username})</span>
                  </>
                ) : (
                  <span>Самостоятельная смена пароля учетной записи</span>
                )}
              </p>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between pt-3 border-t border-white/10 text-[11px] text-slate-300">
            <span>
              Роль: <strong className="text-indigo-200">{currentUser ? getRoleLabel(currentUser.role) : 'Определяется по логину'}</strong>
            </span>
            <span className="flex items-center gap-1 text-emerald-300">
              <ShieldCheck className="w-3 h-3" /> Хэширование PBKDF2 (152-ФЗ)
            </span>
          </div>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4" id="change-password-form">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-xs text-red-700 animate-in fade-in" id="change-password-error-alert">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          )}

          {success && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-2.5 text-xs text-emerald-800 animate-in fade-in" id="change-password-success-alert">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>{success}</div>
            </div>
          )}

          {/* Username Field (if not already locked to currentUser) */}
          {!currentUser && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Логин учетной записи <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  required
                  placeholder="admin, manager, operator, viewer или ваш логин"
                  className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                  id="change-password-username-input"
                />
              </div>
              <div className="flex gap-1.5 mt-1.5">
                {['admin', 'manager', 'operator', 'viewer'].map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => setUsernameInput(u)}
                    className="px-2 py-0.5 text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-md transition-colors"
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Current Password Field */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Текущий пароль <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <Lock className="w-4 h-4" />
              </div>
              <input
                type={showCurrentPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                placeholder="Введите ваш действующий пароль"
                className="w-full pl-9 pr-10 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                id="current-password-input"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                tabIndex={-1}
              >
                {showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* New Password Field */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Новый пароль <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <KeyRound className="w-4 h-4" />
              </div>
              <input
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                placeholder="Не менее 6 символов"
                className="w-full pl-9 pr-10 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                id="new-password-input"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                tabIndex={-1}
              >
                {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {newPassword && (
              <div className="mt-1 flex items-center gap-1.5 text-[10px]">
                <span className={newPassword.length >= 6 ? 'text-emerald-600 font-medium' : 'text-amber-600'}>
                  {newPassword.length >= 6 ? '✓ Достаточная длина' : `Минимум 6 символов (введено: ${newPassword.length})`}
                </span>
              </div>
            )}
          </div>

          {/* Confirm New Password Field */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Повторите новый пароль <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                <KeyRound className="w-4 h-4" />
              </div>
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                placeholder="Повторите новый пароль"
                className="w-full pl-9 pr-10 py-2 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                id="confirm-password-input"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600"
                tabIndex={-1}
              >
                {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {confirmPassword && newPassword && (
              <div className="mt-1 text-[10px]">
                {newPassword === confirmPassword ? (
                  <span className="text-emerald-600 font-medium">✓ Пароли совпадают</span>
                ) : (
                  <span className="text-red-500 font-medium">✗ Пароли не совпадают</span>
                )}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
              id="change-password-cancel-btn"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={loading || !effectiveUsername || !currentPassword || !newPassword || !confirmPassword || newPassword !== confirmPassword || newPassword.length < 6}
              className="px-5 py-2 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl shadow-xs transition-colors flex items-center gap-1.5"
              id="change-password-submit-btn"
            >
              {loading ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Сохранение...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Сменить пароль
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
