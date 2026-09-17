/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Request, Response, NextFunction } from 'express';
import { UserRole, AccessLogEntry } from '../types.js';
import { readStore, writeStore } from '../store/store.js';

export async function logAccess(
  user: string,
  action: AccessLogEntry['action'],
  resource: string,
  ip: string
): Promise<void> {
  try {
    const store = await readStore();
    if (!store.access_log) store.access_log = [];

    const entry: AccessLogEntry = {
      id: `acc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toISOString(),
      user: user || 'Администратор',
      action,
      resource,
      ip: ip || '127.0.0.1',
    };

    store.access_log.unshift(entry);
    if (store.access_log.length > 500) {
      store.access_log = store.access_log.slice(0, 500);
    }
    await writeStore(store);
  } catch (err: any) {
    console.warn('[AccessLog] Ошибка записи журнала доступа:', err.message);
  }
}

export function getCurrentUserRole(req: Request): UserRole {
  const headerRole = req.headers['x-user-role'] as string;
  if (headerRole === 'manager') return 'manager';
  if (headerRole === 'viewer') return 'viewer';
  return 'admin';
}

export function requireRole(allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = getCurrentUserRole(req);
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({
        error: `Доступ запрещён для роли ${role}. Требуется одна из ролей: ${allowedRoles.join(', ')}`,
      });
    }
    next();
  };
}
