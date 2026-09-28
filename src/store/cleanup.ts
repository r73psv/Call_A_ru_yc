/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { readStore, writeStore } from './store.js';
import { readConsentStore, writeConsentStore } from './consent-store.js';
import { ConsentRecord, AccessLogEntry, LogEntry } from '../types.js';

export interface CleanupStats {
  audioRemoved: number;
  contentRemoved: number;
  callsDeleted: number;
  logsCleaned: number;
  accessLogsCleaned: number;
  tempFilesCleaned: number;
  tempBytesCleaned: number;
  revokedConsentsCleaned: number;
  timestamp: string;
}

export interface TempFilesReport {
  totalFiles: number;
  totalBytes: number;
  olderThanDaysFiles: number;
  olderThanDaysBytes: number;
  scannedDirs: string[];
}

const TEMP_DIRECTORIES = [
  path.resolve('/app/temp'),
  path.resolve(process.cwd(), 'temp'),
  path.resolve(process.cwd(), 'uploads'),
  path.resolve(os.tmpdir(), 'lik28-audio-cache'),
  path.resolve(os.tmpdir(), 'lik28-temp')
];

/**
 * Scan configured temporary directories for inspection in the Admin UI
 */
export function scanTempFiles(retentionDays = 30): TempFilesReport {
  let totalFiles = 0;
  let totalBytes = 0;
  let olderThanDaysFiles = 0;
  let olderThanDaysBytes = 0;
  const cutoffTime = Date.now() - retentionDays * 86400000;
  const existingDirs: string[] = [];

  for (const dir of TEMP_DIRECTORIES) {
    if (!fs.existsSync(dir)) continue;
    existingDirs.push(dir);
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          const filePath = path.join(dir, entry.name);
          try {
            const stat = fs.statSync(filePath);
            totalFiles++;
            totalBytes += stat.size;
            if (stat.mtimeMs < cutoffTime || stat.ctimeMs < cutoffTime) {
              olderThanDaysFiles++;
              olderThanDaysBytes += stat.size;
            }
          } catch {}
        }
      }
    } catch {}
  }

  // Also check system os.tmpdir for lik28 / speechkit temporary transcode files
  try {
    const sysTmp = os.tmpdir();
    const tmpEntries = fs.readdirSync(sysTmp, { withFileTypes: true });
    for (const entry of tmpEntries) {
      if (entry.isFile() && (entry.name.startsWith('lik28-') || entry.name.startsWith('speechkit-') || entry.name.startsWith('audio-convert-'))) {
        const filePath = path.join(sysTmp, entry.name);
        try {
          const stat = fs.statSync(filePath);
          totalFiles++;
          totalBytes += stat.size;
          if (stat.mtimeMs < cutoffTime || stat.ctimeMs < cutoffTime) {
            olderThanDaysFiles++;
            olderThanDaysBytes += stat.size;
          }
        } catch {}
      }
    }
  } catch {}

  return {
    totalFiles,
    totalBytes,
    olderThanDaysFiles,
    olderThanDaysBytes,
    scannedDirs: existingDirs
  };
}

/**
 * Remove temporary files older than specified days
 */
export function cleanTempFiles(retentionDays = 30): { filesDeleted: number; bytesFreed: number } {
  let filesDeleted = 0;
  let bytesFreed = 0;
  const cutoffTime = Date.now() - retentionDays * 86400000;

  for (const dir of TEMP_DIRECTORIES) {
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {}
      continue;
    }

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          const filePath = path.join(dir, entry.name);
          try {
            const stat = fs.statSync(filePath);
            if (stat.mtimeMs < cutoffTime || stat.ctimeMs < cutoffTime) {
              fs.unlinkSync(filePath);
              filesDeleted++;
              bytesFreed += stat.size;
            }
          } catch (e: any) {
            console.warn(`[Cleanup] Failed to unlink temp file ${filePath}:`, e.message);
          }
        }
      }
    } catch (e: any) {
      console.warn(`[Cleanup] Error reading temp dir ${dir}:`, e.message);
    }
  }

  // Also clean matching prefixed files in os.tmpdir
  try {
    const sysTmp = os.tmpdir();
    const tmpEntries = fs.readdirSync(sysTmp, { withFileTypes: true });
    for (const entry of tmpEntries) {
      if (entry.isFile() && (entry.name.startsWith('lik28-') || entry.name.startsWith('speechkit-') || entry.name.startsWith('audio-convert-'))) {
        const filePath = path.join(sysTmp, entry.name);
        try {
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs < cutoffTime || stat.ctimeMs < cutoffTime) {
            fs.unlinkSync(filePath);
            filesDeleted++;
            bytesFreed += stat.size;
          }
        } catch {}
      }
    }
  } catch {}

  return { filesDeleted, bytesFreed };
}

export async function runCleanup(): Promise<CleanupStats> {
  const store = await readStore();
  const now = Date.now();
  const stats: CleanupStats = {
    audioRemoved: 0,
    contentRemoved: 0,
    callsDeleted: 0,
    logsCleaned: 0,
    accessLogsCleaned: 0,
    tempFilesCleaned: 0,
    tempBytesCleaned: 0,
    revokedConsentsCleaned: 0,
    timestamp: new Date().toISOString(),
  };

  const autoCleanup = store.config.autoCleanup;
  const isEnabled = autoCleanup?.enabled !== false;
  const logRetentionDays = autoCleanup?.logRetentionDays || parseInt(process.env.TTL_LOG_DAYS || '30', 10);
  const tempFilesRetentionDays = autoCleanup?.tempFilesRetentionDays || parseInt(process.env.TTL_TEMP_DAYS || '30', 10);

  const ttlAudioDays = parseInt(process.env.TTL_AUDIO_DAYS || '30', 10);
  const ttlTranscriptDays = parseInt(process.env.TTL_TRANSCRIPT_DAYS || '90', 10);
  const ttlFullDays = parseInt(process.env.TTL_FULL_DELETE_DAYS || '1095', 10);
  const ttlAccessLogDays = logRetentionDays;
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

  // 4. System logs retention — 30 days per 152-FZ
  if (Array.isArray(store.logs)) {
    const logCutoff = now - logRetentionDays * 86400000;
    const origLogCount = store.logs.length;
    store.logs = store.logs.filter((log: LogEntry) => {
      const logTime = new Date(log.timestamp).getTime();
      return isNaN(logTime) ? true : logTime > logCutoff;
    });
    stats.logsCleaned = origLogCount - store.logs.length;
  }

  // 5. Access audit log retention — 30 days per 152-FZ
  if (Array.isArray(store.access_log)) {
    const accessCutoff = now - ttlAccessLogDays * 86400000;
    const origAccessCount = store.access_log.length;
    store.access_log = store.access_log.filter((log: AccessLogEntry) => {
      const logTime = new Date(log.timestamp).getTime();
      return isNaN(logTime) ? true : logTime > accessCutoff;
    });
    stats.accessLogsCleaned = origAccessCount - store.access_log.length;
  }

  // 6. Temporary files cleanup — 30 days per 152-FZ
  const tempCleanResult = cleanTempFiles(tempFilesRetentionDays);
  stats.tempFilesCleaned = tempCleanResult.filesDeleted;
  stats.tempBytesCleaned = tempCleanResult.bytesFreed;

  // Save metadata to store config
  if (!store.config.autoCleanup) {
    store.config.autoCleanup = {
      enabled: true,
      logRetentionDays,
      tempFilesRetentionDays,
      autoRunDaily: true
    };
  }
  store.config.autoCleanup.lastRunTimestamp = stats.timestamp;
  store.config.autoCleanup.lastRunStats = {
    logsCleaned: stats.logsCleaned,
    accessLogsCleaned: stats.accessLogsCleaned,
    tempFilesCleaned: stats.tempFilesCleaned,
    tempBytesCleaned: stats.tempBytesCleaned,
    audioCleaned: stats.audioRemoved,
    contentCleaned: stats.contentRemoved,
    timestamp: stats.timestamp
  };

  await writeStore(store);

  // 7. Revoked consents cleanup — 3 years after revocation
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

  console.log('[Cleanup TTL] Процедура автоудаления данных 152-ФЗ завершена:', JSON.stringify(stats));
  return stats;
}

export const runCleanupNow = async (): Promise<CleanupStats> => {
  return await runCleanup();
};

let schedulerInterval: NodeJS.Timeout | null = null;

export function initCleanupScheduler(): void {
  if (schedulerInterval) return;
  // Run initial check after 45 seconds
  setTimeout(async () => {
    try {
      const store = await readStore();
      if (store.config.autoCleanup?.enabled !== false) {
        await runCleanup();
      }
    } catch (err: any) {
      console.error('[Cleanup TTL Startup Error]', err.message);
    }
  }, 45000);

  // Run daily at scheduled interval (every 24 hours)
  schedulerInterval = setInterval(async () => {
    try {
      const store = await readStore();
      if (store.config.autoCleanup?.enabled !== false) {
        await runCleanup();
      }
    } catch (err: any) {
      console.error('[Cleanup TTL Interval Error]', err.message);
    }
  }, 24 * 60 * 60 * 1000);
}

