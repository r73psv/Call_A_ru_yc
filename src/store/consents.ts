/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import { readConsentStore, writeConsentStore, readConsentStoreSync } from './consent-store.js';
import { readStore, writeStore } from './store.js';
import { ConsentRecord } from '../types.js';
import { maskPhone } from '../services/anonymize.js';

export const CONSENT_TEXT_VERSION = '1.0';

/**
 * Получить статус согласия для номера телефона синхронно
 */
export function getConsentForPhone(fullPhone: string): ConsentRecord | null {
  if (!fullPhone) return null;
  const phoneHash = hashPhone(fullPhone);
  if (!phoneHash) return null;
  const store = readConsentStoreSync();
  const consent = store.consents.find((c: ConsentRecord) => c.client_phone_hash === phoneHash);
  return consent || null;
}

/**
 * Зарегистрировать согласие или обновить статус
 */
export async function registerConsent(data: {
  client_phone: string;
  consent_type?: string;
  status?: 'active' | 'revoked' | 'expired' | 'not_applicable';
  purposes?: string[];
  call_id?: string;
  call_date?: string;
}): Promise<ConsentRecord> {
  const cleanDigits = (data.client_phone || '').replace(/\D/g, '');
  const phoneHash = cleanDigits.length >= 4 
    ? hashPhone(cleanDigits) 
    : crypto.createHash('sha256').update(`call-${data.call_id || Date.now()}`).digest('hex');
  
  const phoneMasked = cleanDigits.length >= 4 
    ? `****${cleanDigits.slice(-4)}` 
    : (data.client_phone && data.client_phone !== 'Не определен' ? data.client_phone : `Клиент (${(data.call_id || '').slice(-6)})`);

  const store = await readConsentStore();
  
  // Find by call_id_origin first (precise call link), then by phoneHash
  let existing = data.call_id 
    ? store.consents.find((c: ConsentRecord) => c.call_id_origin === data.call_id)
    : undefined;
  
  if (!existing && !data.call_id) {
    existing = store.consents.find((c: ConsentRecord) => c.client_phone_hash === phoneHash);
  }

  if (existing) {
    // Never downgrade an already 'active' consent to 'not_applicable'
    if (data.status && !(existing.status === 'active' && data.status === 'not_applicable')) {
      existing.status = data.status;
    }
    if (data.purposes && data.purposes.length > 0) {
      existing.purposes = Array.from(new Set([...existing.purposes, ...data.purposes]));
    }
    if (data.call_id && !existing.call_id_origin) existing.call_id_origin = data.call_id;
    existing.updated_at = new Date().toISOString();
    await writeConsentStore(store);
    return existing;
  }

  const newConsent: ConsentRecord = {
    consent_id: crypto.randomUUID(),
    client_phone_masked: phoneMasked,
    client_phone_hash: phoneHash,
    consent_date: data.call_date || new Date().toISOString(),
    consent_method: (data.consent_type as any) || 'voice',
    consent_source: 'auto',
    call_id_origin: data.call_id,
    consent_text_version: CONSENT_TEXT_VERSION,
    purposes: data.purposes || (data.status === 'not_applicable' ? [] : ['quality_control', 'ai_analysis']),
    data_categories: ['phone', 'voice', 'call_content'],
    third_party_sharing: true,
    status: data.status || 'active',
    revoked_date: null,
    retention_period_days: 90,
    updated_at: new Date().toISOString()
  };

  store.consents.unshift(newConsent);
  await writeConsentStore(store);
  return newConsent;
}

/**
 * Вычисляет SHA-256 хэш полного номера телефона для безопасного поиска и проверки
 */
export function hashPhone(phone: string, fallbackId?: string): string {
  if (!phone || typeof phone !== 'string') {
    return fallbackId ? crypto.createHash('sha256').update(`fallback-${fallbackId}`).digest('hex') : '';
  }
  const clean = phone.replace(/\D/g, '');
  if (!clean) {
    return fallbackId ? crypto.createHash('sha256').update(`fallback-${fallbackId}`).digest('hex') : '';
  }
  return crypto.createHash('sha256').update(clean).digest('hex');
}

/**
 * Автоматическая регистрация голосового согласия для состоявшегося звонка (152-ФЗ).
 * Вызывается для всех входящих и исходящих звонков с duration > 0 и is_answered = true.
 */
export async function ensureAutoConsent(
  fullPhone: string,
  callId: string,
  callDirection: 'incoming' | 'outgoing',
  callTimestamp?: string
): Promise<ConsentRecord> {
  const cleanDigits = (fullPhone || '').replace(/\D/g, '');
  const phoneHash = cleanDigits.length >= 4 
    ? hashPhone(cleanDigits) 
    : crypto.createHash('sha256').update(`call-${callId || Date.now()}`).digest('hex');
  
  const phoneMasked = cleanDigits.length >= 4 
    ? `****${cleanDigits.slice(-4)}` 
    : (fullPhone && fullPhone !== 'Не определен' ? fullPhone : `Клиент (${(callId || '').slice(-6)})`);

  const store = await readConsentStore();

  // 1. If this exact call already originated a consent, return it
  if (callId) {
    const byCallId = store.consents.find((c: ConsentRecord) => c.call_id_origin === callId);
    if (byCallId) {
      if (byCallId.status !== 'active') {
        byCallId.status = 'active';
        byCallId.purposes = ['quality_control', 'ai_analysis'];
        byCallId.updated_at = new Date().toISOString();
        await writeConsentStore(store);
      }
      return byCallId;
    }
  }

  const newConsent: ConsentRecord = {
    consent_id: crypto.randomUUID(),
    client_phone_masked: phoneMasked,
    client_phone_hash: phoneHash,
    consent_date: callTimestamp || new Date().toISOString(),
    consent_method: 'voice',
    consent_source: 'auto',
    call_id_origin: callId,
    consent_text_version: CONSENT_TEXT_VERSION,
    purposes: ['quality_control', 'ai_analysis'],
    data_categories: ['phone', 'voice', 'call_content'],
    third_party_sharing: true,
    status: 'active',
    revoked_date: null,
    retention_period_days: 90,
    updated_at: new Date().toISOString(),
  };

  store.consents.unshift(newConsent);
  await writeConsentStore(store);

  console.log(
    `[Consents] Авто-согласие успешно зарегистрировано для ${phoneMasked} ` +
    `(${callDirection}, call_id=${callId})`
  );

  return newConsent;
}

/**
 * Синхронизирует реестр согласий со всеми звонками в базе данных.
 * Гарантирует, что для каждого звонка зафиксирован статус согласия согласно 152-ФЗ.
 */
export async function syncConsentsFromCalls(calls: any[]): Promise<number> {
  if (!calls || !Array.isArray(calls) || calls.length === 0) return 0;

  const store = await readConsentStore();
  let createdCount = 0;
  let updatedAny = false;

  const byCallId = new Map<string, ConsentRecord>();
  const byConsentId = new Map<string, ConsentRecord>();
  for (const c of store.consents) {
    if (c.call_id_origin) byCallId.set(c.call_id_origin, c);
    if (c.consent_id) byConsentId.set(c.consent_id, c);
  }

  for (const call of calls) {
    const rawPhone = call.client_phone || call.full_phone || call.client_phone_masked || call.client_name || '';
    const cleanDigits = String(rawPhone).replace(/\D/g, '');

    const phoneHash = cleanDigits.length >= 4
      ? crypto.createHash('sha256').update(cleanDigits).digest('hex')
      : crypto.createHash('sha256').update(`call-${call.call_id}`).digest('hex');

    const phoneMasked = cleanDigits.length >= 4 
      ? `****${cleanDigits.slice(-4)}` 
      : (call.client_name && String(call.client_name).includes('(') ? String(call.client_name) : `Клиент (${String(call.call_id).slice(-6)})`);

    const isAnswered = call.is_answered !== false && (call.duration_seconds > 0 || call.status === 'completed');
    const targetStatus = isAnswered ? 'active' : 'not_applicable';

    // 1. Try finding by call origin
    let existing = call.call_id ? byCallId.get(call.call_id) : undefined;

    // 2. Try finding by existing consent_id
    if (!existing && call.consent_id) {
      existing = byConsentId.get(call.consent_id);
    }

    if (existing) {
      if (isAnswered && existing.status !== 'active') {
        existing.status = 'active';
        existing.purposes = ['quality_control', 'ai_analysis'];
        existing.updated_at = new Date().toISOString();
        updatedAny = true;
      }
      if (!call.consent_id) {
        call.consent_id = existing.consent_id;
        byConsentId.set(existing.consent_id, existing);
        updatedAny = true;
      }
      if (call.consent_status !== existing.status) {
        call.consent_status = existing.status;
        updatedAny = true;
      }
    } else {
      const newConsent: ConsentRecord = {
        consent_id: call.consent_id || crypto.randomUUID(),
        client_phone_masked: phoneMasked,
        client_phone_hash: phoneHash,
        consent_date: call.timestamp || new Date().toISOString(),
        consent_method: 'voice',
        consent_source: 'auto',
        call_id_origin: call.call_id,
        consent_text_version: CONSENT_TEXT_VERSION,
        purposes: isAnswered ? ['quality_control', 'ai_analysis'] : [],
        data_categories: ['phone', 'voice', 'call_content'],
        third_party_sharing: true,
        status: targetStatus,
        revoked_date: null,
        retention_period_days: 90,
        updated_at: new Date().toISOString()
      };

      store.consents.push(newConsent);
      if (newConsent.call_id_origin) byCallId.set(newConsent.call_id_origin, newConsent);
      byConsentId.set(newConsent.consent_id, newConsent);
      call.consent_id = newConsent.consent_id;
      call.consent_status = newConsent.status;
      createdCount++;
      updatedAny = true;
    }
  }

  if (updatedAny || createdCount > 0) {
    await writeConsentStore(store);
  }

  return createdCount;
}

/**
 * Проверка наличия согласия на конкретную цель (например, 'ai_analysis' или 'loyalty_program')
 */
export async function checkConsentForPurpose(
  fullPhone: string,
  purpose: string
): Promise<{ hasConsent: boolean; consent: ConsentRecord | null }> {
  const phoneHash = hashPhone(fullPhone);
  const store = await readConsentStore();

  const consent = store.consents.find(
    (c: ConsentRecord) =>
      c.client_phone_hash === phoneHash &&
      c.status === 'active' &&
      c.purposes.includes(purpose)
  );

  return { hasConsent: !!consent, consent: consent || null };
}

/**
 * Расширение согласия новой целью (loyalty_program).
 * Если согласие уже есть — добавляет цель и обновляет method на 'written' | 'digital'.
 * Если согласия нет — создаёт новое с полным набором целей.
 */
export async function grantLoyaltyConsent(
  fullPhone: string,
  method: 'written' | 'digital'
): Promise<ConsentRecord> {
  const phoneHash = hashPhone(fullPhone);
  const phoneMasked = maskPhone(fullPhone);

  const store = await readConsentStore();
  const existing = store.consents.find(
    (c: ConsentRecord) =>
      c.client_phone_hash === phoneHash && c.status === 'active'
  );

  if (existing) {
    if (!existing.purposes.includes('loyalty_program')) {
      existing.purposes.push('loyalty_program');
    }
    existing.consent_method = method;
    existing.consent_source = 'manual';
    if (!existing.data_categories.includes('name')) {
      existing.data_categories.push('name');
    }
    existing.updated_at = new Date().toISOString();

    await writeConsentStore(store);
    console.log(
      `[Consents] Согласие для ${phoneMasked} расширено: добавлена цель 'loyalty_program'`
    );
    return existing;
  }

  const newConsent: ConsentRecord = {
    consent_id: crypto.randomUUID(),
    client_phone_masked: phoneMasked,
    client_phone_hash: phoneHash,
    consent_date: new Date().toISOString(),
    consent_method: method,
    consent_source: 'manual',
    consent_text_version: CONSENT_TEXT_VERSION,
    purposes: ['quality_control', 'ai_analysis', 'loyalty_program'],
    data_categories: ['phone', 'voice', 'call_content', 'name'],
    third_party_sharing: true,
    status: 'active',
    revoked_date: null,
    retention_period_days: 90,
    updated_at: new Date().toISOString(),
  };

  store.consents.unshift(newConsent);
  await writeConsentStore(store);

  console.log(
    `[Consents] Полное согласие для ${phoneMasked} оформлено вручную (${method})`
  );
  return newConsent;
}

/**
 * Отзыв согласия клиентом — немедленное удаление всех связанных данных (152-ФЗ).
 */
export async function revokeConsent(consentId: string): Promise<void> {
  const store = await readConsentStore();
  const consent = store.consents.find((c: ConsentRecord) => c.consent_id === consentId);

  if (!consent) {
    throw new Error(`Согласие с ID ${consentId} не найдено`);
  }

  // Удаление данных клиента из основного хранилища звонков
  await deleteClientData(consent.client_phone_hash);

  // Обновление статуса согласия для всех записей этого клиента (сохраняется 3 года согласно законодательству)
  const phoneHash = consent.client_phone_hash;
  const now = new Date().toISOString();
  for (const c of store.consents) {
    if (c.consent_id === consentId || (phoneHash && c.client_phone_hash === phoneHash)) {
      c.status = 'revoked';
      c.revoked_date = now;
      c.updated_at = now;
    }
  }

  await writeConsentStore(store);

  console.log(
    `[Consents] Согласие ${consentId} отозвано. Данные клиента ${consent.client_phone_masked} удалены.`
  );
}

/**
 * Полное удаление записей звонков конкретного клиента по хэшу телефона
 */
export async function deleteClientData(phoneHash: string): Promise<void> {
  const store = await readStore();
  const beforeCount = store.calls.length;
  
  store.calls = store.calls.filter((c: any) => {
    if (!c.full_phone) return true;
    const callHash = hashPhone(c.full_phone);
    return callHash !== phoneHash;
  });

  const deletedCount = beforeCount - store.calls.length;
  await writeStore(store);
  console.log(`[Consents] Удалено ${deletedCount} звонков по запросу отзыва согласия`);
}
