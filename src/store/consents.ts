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
}): Promise<ConsentRecord> {
  const phoneHash = hashPhone(data.client_phone);
  const phoneMasked = maskPhone(data.client_phone);

  const store = await readConsentStore();
  let existing = store.consents.find((c: ConsentRecord) => c.client_phone_hash === phoneHash);

  if (existing) {
    if (data.status) existing.status = data.status;
    if (data.purposes) existing.purposes = data.purposes;
    existing.updated_at = new Date().toISOString();
    await writeConsentStore(store);
    return existing;
  }

  const newConsent: ConsentRecord = {
    consent_id: crypto.randomUUID(),
    client_phone_masked: phoneMasked,
    client_phone_hash: phoneHash,
    consent_date: new Date().toISOString(),
    consent_method: (data.consent_type as any) || 'voice',
    consent_source: 'auto',
    call_id_origin: data.call_id,
    consent_text_version: CONSENT_TEXT_VERSION,
    purposes: data.purposes || ['quality_control', 'ai_analysis'],
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
export function hashPhone(phone: string): string {
  const clean = phone.replace(/\D/g, '');
  return crypto.createHash('sha256').update(clean).digest('hex');
}

/**
 * Автоматическая регистрация голосового согласия для состоявшегося звонка (152-ФЗ).
 * Вызывается для всех входящих и исходящих звонков с duration > 0 и is_answered = true.
 */
export async function ensureAutoConsent(
  fullPhone: string,
  callId: string,
  callDirection: 'incoming' | 'outgoing'
): Promise<ConsentRecord> {
  const phoneHash = hashPhone(fullPhone);
  const phoneMasked = maskPhone(fullPhone);

  const store = await readConsentStore();
  const existing = store.consents.find(
    (c: ConsentRecord) =>
      c.client_phone_hash === phoneHash && c.status === 'active'
  );

  if (existing) {
    console.log(
      `[Consents] Активное согласие уже существует для ${phoneMasked} (method=${existing.consent_method})`
    );
    return existing;
  }

  const newConsent: ConsentRecord = {
    consent_id: crypto.randomUUID(),
    client_phone_masked: phoneMasked,
    client_phone_hash: phoneHash,
    consent_date: new Date().toISOString(),
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

  // Обновление статуса согласия (сохраняется 3 года согласно законодательству)
  consent.status = 'revoked';
  consent.revoked_date = new Date().toISOString();
  consent.updated_at = new Date().toISOString();

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
