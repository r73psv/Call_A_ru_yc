/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  Users, UserPlus, Shield, KeyRound, Edit2, Trash2, 
  CheckCircle2, XCircle, AlertCircle, RefreshCw, Lock, Sparkles, X
} from 'lucide-react';
import { UserRole } from '../../types.js';

interface UserItem {
  id: string;
  username: string;
  name: string;
  role: UserRole;
  createdAt: string;
  updatedAt?: string;
  lastLoginAt?: string;
  isActive: boolean;
  notes?: string;
}

interface UsersManagementProps {
  authToken?: string | null;
  currentUserId?: string;
}

export function UsersManagement({ authToken, currentUserId }: UsersManagementProps) {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Create Modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newName, setNewName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('operator');
  const [newNotes, setNewNotes] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);

  // Edit Modal
  const [editingUser, setEditingUser] = useState<UserItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('operator');
  const [editPassword, setEditPassword] = useState('');
  const [editIsActive, setEditIsActive] = useState(true);
  const [editNotes, setEditNotes] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);

  const getHeaders = () => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) h['Authorization'] = `Bearer ${authToken}`;
    return h;
  };

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/users', { headers: getHeaders() });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Ошибка загрузки пользователей');
      }
      const data = await res.json();
      setUsers(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          username: newUsername,
          name: newName,
          password: newPassword,
          role: newRole,
          notes: newNotes,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка создания пользователя');

      setIsCreateOpen(false);
      setNewUsername('');
      setNewName('');
      setNewPassword('');
      setNewNotes('');
      setSuccessMsg(`Пользователь «${data.username}» успешно создан`);
      await loadUsers();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreateSubmitting(false);
    }
  };

  const startEdit = (u: UserItem) => {
    setEditingUser(u);
    setEditName(u.name);
    setEditRole(u.role);
    setEditPassword('');
    setEditIsActive(u.isActive);
    setEditNotes(u.notes || '');
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setEditSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const body: any = {
        name: editName,
        role: editRole,
        isActive: editIsActive,
        notes: editNotes,
      };
      if (editPassword.trim().length >= 6) {
        body.password = editPassword.trim();
      }

      const res = await fetch(`/api/admin/users/${editingUser.id}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка обновления пользователя');

      setEditingUser(null);
      setSuccessMsg(`Данные пользователя «${data.username}» обновлены`);
      await loadUsers();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleDeleteUser = async (u: UserItem) => {
    if (!confirm(`Вы действительно хотите удалить пользователя ${u.username} (${u.name})?`)) {
      return;
    }

    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: 'DELETE',
        headers: getHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка удаления пользователя');

      setSuccessMsg(data.message || 'Пользователь удален');
      await loadUsers();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'admin':
        return <span className="bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded-full text-[11px] font-bold">👑 Администратор</span>;
      case 'manager':
        return <span className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full text-[11px] font-bold">👔 Управляющий</span>;
      case 'operator':
        return <span className="bg-purple-50 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full text-[11px] font-bold">🎧 Оператор</span>;
      case 'viewer':
        return <span className="bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5 rounded-full text-[11px] font-bold">👁️ Наблюдатель</span>;
    }
  };

  return (
    <div className="space-y-5" id="users-management-section">
      {/* Top Banner & Action */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-emerald-600" />
            Управление доступом сотрудников к системе CallQA
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Контроль учетных записей, распределение ролей и защита персональных данных (152-ФЗ)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadUsers}
            disabled={loading}
            className="p-2 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-slate-600 transition-colors"
            title="Обновить список"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1.5"
            id="add-user-btn"
          >
            <UserPlus className="w-4 h-4" /> Добавить пользователя
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-rose-800">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-start gap-2.5 text-xs text-emerald-800">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Role Descriptions Info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
        <div className="bg-white p-3 rounded-xl border border-slate-200">
          <div className="font-bold text-red-700 flex items-center gap-1.5 mb-1">
            <Shield className="w-3.5 h-3.5" /> Администратор (admin)
          </div>
          <p className="text-[11px] text-slate-500">
            Полный доступ к панели администратора, всем токенам и API-ключам, открытым номерам и управлению пользователями.
          </p>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200">
          <div className="font-bold text-blue-700 flex items-center gap-1.5 mb-1">
            <Shield className="w-3.5 h-3.5" /> Управляющий (manager)
          </div>
          <p className="text-[11px] text-slate-500">
            Оценки звонков, переанализ, отправка в VK/YClients, реестр согласий. Номера телефонов маскированы по 152-ФЗ.
          </p>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200">
          <div className="font-bold text-purple-700 flex items-center gap-1.5 mb-1">
            <Shield className="w-3.5 h-3.5" /> Оператор (operator)
          </div>
          <p className="text-[11px] text-slate-500">
            Администратор ресепшн. Просмотр оценок, рекомендаций и стенограмм для совершенствования речевых стандартов.
          </p>
        </div>
        <div className="bg-white p-3 rounded-xl border border-slate-200">
          <div className="font-bold text-slate-700 flex items-center gap-1.5 mb-1">
            <Shield className="w-3.5 h-3.5" /> Наблюдатель (viewer)
          </div>
          <p className="text-[11px] text-slate-500">
            Аудитор. Только обезличенная сводная статистика без доступа к персональным данным, телефонам и транскриптам.
          </p>
        </div>
      </div>

      {/* Info note about self-service password changes */}
      <div className="bg-indigo-50/70 border border-indigo-200/80 rounded-xl p-3 flex items-center justify-between gap-3 text-xs text-indigo-900">
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-indigo-600 shrink-0" />
          <span>
            <strong>Самостоятельная смена пароля:</strong> Каждый пользователь может самостоятельно изменить свой пароль в любой момент через значок ключа в шапке приложения или по ссылке в окне входа.
          </span>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs" id="users-table">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold">
              <tr>
                <th className="px-4 py-3">Пользователь / ФИО</th>
                <th className="px-4 py-3">Логин</th>
                <th className="px-4 py-3">Роль доступа</th>
                <th className="px-4 py-3">Статус</th>
                <th className="px-4 py-3">Последний вход</th>
                <th className="px-4 py-3 text-right">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.map((u) => {
                const isCurrent = currentUserId === u.id || u.username === 'admin';
                return (
                  <tr key={u.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900">{u.name}</div>
                      {u.notes && <div className="text-[11px] text-slate-400 truncate max-w-xs">{u.notes}</div>}
                    </td>
                    <td className="px-4 py-3 font-mono font-medium text-slate-700">
                      @{u.username}
                    </td>
                    <td className="px-4 py-3">
                      {getRoleBadge(u.role)}
                    </td>
                    <td className="px-4 py-3">
                      {u.isActive ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Активен
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-700 font-medium">
                          <XCircle className="w-3.5 h-3.5 text-rose-600" /> Заблокирован
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-[11px]">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('ru-RU') : 'Ещё не входил'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => startEdit(u)}
                          className="p-1.5 text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors"
                          title="Редактировать пользователя"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteUser(u)}
                          disabled={u.role === 'admin'}
                          className={`p-1.5 rounded-lg transition-colors ${
                            u.role === 'admin'
                              ? 'text-slate-300 cursor-not-allowed'
                              : 'text-slate-500 hover:text-rose-700 hover:bg-rose-50'
                          }`}
                          title={u.role === 'admin' ? 'Администратора нельзя удалить' : 'Удалить пользователя'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create User Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-slate-200 overflow-hidden">
            <div className="bg-emerald-700 p-4 text-white flex justify-between items-center">
              <h4 className="font-bold text-sm flex items-center gap-2">
                <UserPlus className="w-4 h-4" /> Добавление нового пользователя
              </h4>
              <button onClick={() => setIsCreateOpen(false)} className="text-emerald-200 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateUser} className="p-5 space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Имя пользователя (Логин)*</label>
                <input
                  type="text"
                  required
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="например, olga_reception"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">ФИО / Отображаемое имя*</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="например, Ольга Смирнова"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Роль доступа*</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserRole)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-hidden"
                >
                  <option value="operator">🎧 Оператор (Администратор ресепшн салона)</option>
                  <option value="manager">👔 Управляющий (Контроль качества & Реестр согласий)</option>
                  <option value="viewer">👁️ Наблюдатель (Аудитор, только сводная аналитика)</option>
                  <option value="admin">👑 Администратор (Полный доступ к системе и API-ключам)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Пароль (не менее 6 символов)*</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Задайте надежный пароль"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Примечание / Должность</label>
                <input
                  type="text"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="например, Смена 2/2 ресепшн"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-hidden"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={createSubmitting}
                  className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white font-bold text-xs rounded-xl shadow-xs"
                >
                  {createSubmitting ? 'Сохранение...' : 'Создать пользователя'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full border border-slate-200 overflow-hidden">
            <div className="bg-slate-900 p-4 text-white flex justify-between items-center">
              <h4 className="font-bold text-sm flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-emerald-400" /> Редактирование: @{editingUser.username}
              </h4>
              <button onClick={() => setEditingUser(null)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleUpdateUser} className="p-5 space-y-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">ФИО / Отображаемое имя</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Роль доступа</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-hidden"
                >
                  <option value="operator">🎧 Оператор (Администратор ресепшн)</option>
                  <option value="manager">👔 Управляющий</option>
                  <option value="viewer">👁️ Наблюдатель (Аудитор)</option>
                  <option value="admin">👑 Администратор</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Новый пароль (оставьте пустым, если не меняется)
                </label>
                <input
                  type="password"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  placeholder="Минимум 6 знаков для смены пароля"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-hidden"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Статус учетной записи</label>
                <div className="flex items-center gap-4 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-800">
                    <input
                      type="radio"
                      name="isActive"
                      checked={editIsActive}
                      onChange={() => setEditIsActive(true)}
                      className="text-emerald-600 focus:ring-emerald-500"
                    />
                    Активен
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-800">
                    <input
                      type="radio"
                      name="isActive"
                      checked={!editIsActive}
                      onChange={() => setEditIsActive(false)}
                      className="text-rose-600 focus:ring-rose-500"
                    />
                    Заблокирован
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Заметки / Описание</label>
                <input
                  type="text"
                  value={editNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500 focus:bg-white focus:outline-hidden"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={editSubmitting}
                  className="flex-1 py-2 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 text-white font-bold text-xs rounded-xl shadow-xs"
                >
                  {editSubmitting ? 'Сохранение...' : 'Сохранить изменения'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
