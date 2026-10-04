/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, Request, Response } from 'express';
import { readConsentStore, writeConsentStore } from '../store/consent-store.js';
import { readStoreSync, writeStore } from '../store/store.js';
import { 
  ensureAutoConsent, 
  grantLoyaltyConsent, 
  revokeConsent, 
  hashPhone,
  syncConsentsFromCalls,
  CONSENT_TEXT_VERSION
} from '../store/consents.js';
import { maskPhone } from '../services/anonymize.js';
import { logAccess, requireRole, getCurrentUserRole } from './auth.js';
import { ConsentRecord } from '../types.js';
import crypto from 'crypto';

export const consentsRouter = Router();

// GET /api/consents/check?phone_hash={hash}&purpose=ai_analysis
consentsRouter.get('/check', async (req: Request, res: Response) => {
  try {
    const { phone_hash, purpose, phone } = req.query;
    const targetHash = (phone_hash as string) || (phone ? hashPhone(phone as string) : '');

    if (!targetHash) {
      return res.status(400).json({ error: 'Параметр phone_hash или phone обязателен' });
    }

    const store = await readConsentStore();
    const consent = store.consents.find(
      (c) => c.client_phone_hash === targetHash && c.status === 'active'
    );

    if (purpose) {
      const hasConsent = Boolean(consent && consent.purposes.includes(purpose as string));
      return res.json({ hasConsent, consent: consent || null });
    }

    res.json({
      hasConsent: Boolean(consent),
      consent: consent || null,
      purposes: consent ? consent.purposes : [],
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/consents?page=1&limit=500&status=all
consentsRouter.get('/', requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const page = parseInt((req.query.page as string) || '1', 10);
    const limit = parseInt((req.query.limit as string) || '500', 10);
    const status = req.query.status as string;
    const search = ((req.query.search as string) || '').toLowerCase();

    // Auto-reconcile consents from calls so no call is left without a consent record
    try {
      const mainDb = readStoreSync();
      if (mainDb.calls && mainDb.calls.length > 0) {
        const createdCount = await syncConsentsFromCalls(mainDb.calls);
        if (createdCount > 0) {
          mainDb.consents = (await readConsentStore()).consents;
          await writeStore(mainDb);
        }
      }
    } catch (syncErr: any) {
      console.warn('[Consents] Ошибка авто-сверки согласий со звонками:', syncErr.message);
    }

    await logAccess(
      getCurrentUserRole(req),
      'read',
      'Реестр согласий 152-ФЗ',
      req.ip || '127.0.0.1'
    );

    const store = await readConsentStore();
    let items = store.consents;

    const activeCount = store.consents.filter(c => c.status === 'active').length;
    const naCount = store.consents.filter(c => c.status === 'not_applicable').length;
    const revokedCount = store.consents.filter(c => c.status === 'revoked').length;

    if (status && status !== 'all') {
      items = items.filter((c) => c.status === status);
    }

    if (search) {
      items = items.filter(
        (c) =>
          (c.client_phone_masked && c.client_phone_masked.toLowerCase().includes(search)) ||
          (c.consent_id && c.consent_id.toLowerCase().includes(search)) ||
          (c.consent_method && c.consent_method.toLowerCase().includes(search)) ||
          (c.call_id_origin && c.call_id_origin.toLowerCase().includes(search))
      );
    }

    const total = items.length;
    const startIndex = (page - 1) * limit;
    const paginated = items.slice(startIndex, startIndex + limit);

    const mainDb = readStoreSync();
    res.json({
      items: paginated,
      total,
      totalCalls: mainDb.calls?.length || 0,
      activeCount,
      naCount,
      revokedCount,
      page,
      limit,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/consents/sync — Принудительная синхронизация реестра со звонками базы данных
consentsRouter.post('/sync', requireRole(['admin', 'manager']), async (req: Request, res: Response) => {
  try {
    const mainDb = readStoreSync();
    const calls = mainDb.calls || [];
    const createdCount = await syncConsentsFromCalls(calls);
    const store = await readConsentStore();
    mainDb.consents = store.consents;
    await writeStore(mainDb);

    res.json({
      success: true,
      createdCount,
      totalConsents: store.consents.length,
      activeCount: store.consents.filter(c => c.status === 'active').length,
      totalCalls: calls.length
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/consents/loyalty — Оформление программы лояльности (расширение согласия)
consentsRouter.post('/loyalty', requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const { phone, method } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Номер телефона обязателен' });
    }

    const consentMethod = (method === 'digital' ? 'digital' : 'written') as 'written' | 'digital';
    const consent = await grantLoyaltyConsent(phone, consentMethod);

    await logAccess(
      getCurrentUserRole(req),
      'consent_grant',
      `Согласие на программу лояльности (${consent.client_phone_masked})`,
      req.ip || '127.0.0.1'
    );

    res.json({
      consent_id: consent.consent_id,
      purposes: consent.purposes,
      status: consent.status,
      method: consent.consent_method,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/consents — Полное ручное согласие
consentsRouter.post('/', requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const { phone, method, purposes } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'Номер телефона обязателен' });
    }

    const phoneHash = hashPhone(phone);
    const phoneMasked = maskPhone(phone);
    const store = await readConsentStore();

    const existing = store.consents.find(
      (c) => c.client_phone_hash === phoneHash && c.status === 'active'
    );

    const chosenPurposes = Array.isArray(purposes) && purposes.length > 0
      ? purposes
      : ['quality_control', 'ai_analysis', 'loyalty_program'];

    let consentRecord: ConsentRecord;

    if (existing) {
      for (const p of chosenPurposes) {
        if (!existing.purposes.includes(p)) {
          existing.purposes.push(p);
        }
      }
      existing.consent_method = method || 'written';
      existing.consent_source = 'manual';
      existing.updated_at = new Date().toISOString();
      consentRecord = existing;
    } else {
      consentRecord = {
        consent_id: crypto.randomUUID(),
        client_phone_masked: phoneMasked,
        client_phone_hash: phoneHash,
        consent_date: new Date().toISOString(),
        consent_method: method || 'written',
        consent_source: 'manual',
        consent_text_version: CONSENT_TEXT_VERSION,
        purposes: chosenPurposes,
        data_categories: ['phone', 'voice', 'call_content', 'name'],
        third_party_sharing: true,
        status: 'active',
        revoked_date: null,
        retention_period_days: 90,
        updated_at: new Date().toISOString(),
      };
      store.consents.unshift(consentRecord);
    }

    await writeConsentStore(store);

    await logAccess(
      getCurrentUserRole(req),
      'consent_grant',
      `Ручное оформление согласия (${phoneMasked})`,
      req.ip || '127.0.0.1'
    );

    res.json({ consent_id: consentRecord.consent_id, consent: consentRecord });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/consents/:id/revoke — Отзыв согласия
consentsRouter.post('/:id/revoke', requireRole(['admin']), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await revokeConsent(id);

    await logAccess(
      getCurrentUserRole(req),
      'consent_revoke',
      `Отзыв согласия ${id} и удаление данных 152-ФЗ`,
      req.ip || '127.0.0.1'
    );

    res.json({ status: 'revoked', data_deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
