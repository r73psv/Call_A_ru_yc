/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import { User, UserRole } from '../types.js';

export interface PasswordHashResult {
  hash: string;
  salt: string;
}

/**
 * Хэширует пароль с использованием PBKDF2 (SHA-512, 100,000 итераций)
 */
export function hashPassword(password: string, existingSalt?: string): PasswordHashResult {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

/**
 * Проверяет соответствие пароля хэшу
 */
export function verifyPassword(password: string, hash: string, salt: string): boolean {
  if (!password || !hash || !salt) return false;
  const computed = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hash));
}

/**
 * Возвращает начальных пользователей системы с надежными хэшами паролей
 */
export function getInitialUsers(): User[] {
  const adminPwd = process.env.ADMIN_INITIAL_PASSWORD || process.env.ADMIN_PASSWORD || 'admin123';
  const managerPwd = process.env.MANAGER_INITIAL_PASSWORD || process.env.MANAGER_PASSWORD || 'manager123';
  const adminH = hashPassword(adminPwd);
  const managerH = hashPassword(managerPwd);
  const operatorH = hashPassword('operator123');
  const viewerH = hashPassword('viewer123');

  const now = new Date().toISOString();

  return [
    {
      id: 'usr-admin-1',
      username: 'admin',
      name: 'Главный Администратор',
      role: 'admin',
      passwordHash: adminH.hash,
      salt: adminH.salt,
      createdAt: now,
      isActive: true,
      notes: 'Полный доступ ко всей системе, API-ключам, токенам и управлению пользователями',
    },
    {
      id: 'usr-manager-1',
      username: 'manager',
      name: 'Управляющий салона (Лик 28)',
      role: 'manager',
      passwordHash: managerH.hash,
      salt: managerH.salt,
      createdAt: now,
      isActive: true,
      notes: 'Контроль качества обслуживания, анализ звонков, работа с реестром согласий',
    },
    {
      id: 'usr-operator-1',
      username: 'operator',
      name: 'Администратор ресепшн (Анна)',
      role: 'operator',
      passwordHash: operatorH.hash,
      salt: operatorH.salt,
      createdAt: now,
      isActive: true,
      notes: 'Просмотр стенограмм и рекомендаций для совершенствования речевых стандартов',
    },
    {
      id: 'usr-viewer-1',
      username: 'viewer',
      name: 'Аудитор / Наблюдатель',
      role: 'viewer',
      passwordHash: viewerH.hash,
      salt: viewerH.salt,
      createdAt: now,
      isActive: true,
      notes: 'Обезличенная статистика и сводные показатели без доступа к ПДн',
    },
  ];
}
