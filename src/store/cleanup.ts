/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { readStore, writeStore } from './store.js';
import { readConsentStore, writeConsentStore } from './consent-store.js';
import { ConsentRecord, AccessLogEntry } from '../types.js';

export interface CleanupStats {
  audioRemoved: number;
  contentRemoved: number;
  callsDeleted: number;
  logsCleaned: number;
  revokedConsentsCleaned: number;
  timestamp: string;
}

export async function runCleanup(): Promise<CleanupStats> {
  const store = await readStore();
  const now = Date.now();
  const stats: CleanupStats = {
    audioRemoved: 0,
    contentRemoved: 0,
    callsDeleted: 0,
    logsCleaned: 0,
    revokedConsentsCleaned: 0,
    timestamp: new Date().toISOString(),
  };

  const ttlAudioDays = parseInt(process.env.TTL_AUDIO_DAYS || '30', 10);
  const ttlTranscriptDays = parseInt(process.env.TTL_TRANSCRIPT_DAYS || '90', 10);
  const ttlFullDays = parseInt(process.env.TTL_FULL_DELETE_DAYS || '1095', 10);
  const ttlAccessLogDays = parseInt(process.env.TTL_ACCESS_LOG_DAYS || '90', 10);
  const ttlRevokedConsentDays = parseInt(process.env.TTL_REVOKED_CONSENT_DAYS || '1095', 10);

  const initialCount = store.calls.length;

  for (const call of store.calls) {
    const callDate = new Date(call.timestamp).getTime();
    const ageDays = Math.floor((now - callDate) / 86400000);

    // 1. 30 days — delete audio URL link
    if (ageDays > ttlAudioDays && call.audio_url) {
      delete call.audio_url;
      call.audio_deleted = true;
      call.audio_deleted_at = new Date().toISOString();
      stats.audioRemoved++;
    }

    // 2. 90 days — delete transcript, summary, and analysis
    if (ageDays > ttlTranscriptDays && (call.transcript || call.summary)) {
      call.transcript = '[Удалено согласно 152-ФЗ по истечении 90 дней]';
      call.summary = '[Удалено по истечении срока хранения]';
      call.operator_comment = '';
      call.operator_score = null;
      call.content_deleted = true;
      call.content_deleted_at = new Date().toISOString();
      stats.contentRemoved++;
    }
  }

  // 3. 3 years (1095 days) — complete removal of the call record
  store.calls = store.calls.filter((call) => {
    const callDate = new Date(call.timestamp).getTime();
    const ageDays = Math.floor((now - callDate) / 86400000);
    return ageDays <= ttlFullDays;
  });
  stats.callsDeleted = initialCount - store.calls.length;

  // 4. Access log retention — 90 days
  if (Array.isArray(store.access_log)) {
    const logCutoff = now - ttlAccessLogDays * 86400000;
    const origLogCount = store.access_log.length;
    store.access_log = store.access_log.filter((log: AccessLogEntry) => {
      return new Date(log.timestamp).getTime() > logCutoff;
    });
    stats.logsCleaned = origLogCount - store.access_log.length;
  }

  await writeStore(store);

  // 5. Revoked consents cleanup — 3 years after revocation
  const consentStore = await readConsentStore();
  const origConsentsCount = consentStore.consents.length;
  const revokedCutoff = now - ttlRevokedConsentDays * 86400000;

  consentStore.consents = consentStore.consents.filter((c: ConsentRecord) => {
    if (c.status === 'revoked' && c.revoked_date) {
      return new Date(c.revoked_date).getTime() > revokedCutoff;
    }
    return true;
  });
  stats.revokedConsentsCleaned = origConsentsCount - consentStore.consents.length;

  await writeConsentStore(consentStore);

  console.log('[Cleanup TTL] Процедура автоудаления данных завершена:', JSON.stringify(stats));
  return stats;
}

export const runCleanupNow = async (): Promise<{ audioDeleted: number; transcriptsPurged: number }> => {
  const result = await runCleanup();
  return {
    audioDeleted: result.audioRemoved,
    transcriptsPurged: result.contentRemoved
  };
};

let schedulerInterval: NodeJS.Timeout | null = null;

export function initCleanupScheduler(): void {
  if (schedulerInterval) return;
  // Run once on startup after 1 minute
  setTimeout(() => {
    runCleanup().catch(err => console.error('[Cleanup TTL Startup Error]', err));
  }, 60000);

  // Run daily at 03:00 Moscow Time (or every 24 hours)
  schedulerInterval = setInterval(() => {
    runCleanup().catch(err => console.error('[Cleanup TTL Interval Error]', err));
  }, 24 * 60 * 60 * 1000);
}
