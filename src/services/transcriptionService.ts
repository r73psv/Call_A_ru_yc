/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { isYandexAuthConfigured } from './yandex-auth.js';
import { transcribeWithRetry, refineTranscriptRoles, fixDuplicatedTranscript } from './speechkit.js';

export interface TranscriptionResult {
  text: string;
  engine: 'speechkit' | 'none';
  error?: string;
}

/**
 * Исключительно отечественный стек распознавания речи (152-ФЗ РФ):
 * Основной и единственный сервис: Yandex SpeechKit (Yandex Cloud).
 * Использование не российских моделей в работе приложения строго запрещено.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  _mimeType: string = 'audio/mp3',
  onLog?: (type: 'info' | 'success' | 'warning' | 'error', msg: string) => void
): Promise<TranscriptionResult> {
  const log = (type: 'info' | 'success' | 'warning' | 'error', msg: string) => {
    if (onLog) {
      onLog(type, msg);
    }
  };

  // 1. Проверка конфигурации авторизации Yandex Cloud SpeechKit
  if (!isYandexAuthConfigured()) {
    const errorMsg = 'Yandex SpeechKit не настроен (отсутствует authorized_key.json или API-ключ YC_API_KEY). Настройте сервисный аккаунт в панели управления.';
    log('warning', `[STT] ${errorMsg}`);
    return {
      text: '',
      engine: 'none',
      error: errorMsg,
    };
  }

  // 2. Распознавание через Yandex SpeechKit
  try {
    log('info', '[STT] Запуск распознавания аудиозаписи через российскую модель Yandex SpeechKit...');
    const skRaw = await transcribeWithRetry(audioBuffer);
    if (skRaw && skRaw.trim().length > 0) {
      const cleaned = fixDuplicatedTranscript(refineTranscriptRoles(skRaw.trim()));
      log('success', `[STT] Речь успешно расшифрована Yandex SpeechKit (${cleaned.length} симв.)`);
      return {
        text: cleaned,
        engine: 'speechkit',
      };
    } else {
      const emptyMsg = 'Аудиозапись не содержит разборчивой речи (тишина или звуковой сигнал).';
      log('info', `[STT] Yandex SpeechKit: ${emptyMsg}`);
      return {
        text: '',
        engine: 'speechkit',
        error: emptyMsg,
      };
    }
  } catch (err: any) {
    const skError = err.message || String(err);
    log('error', `[STT] Ошибка распознавания речи Yandex SpeechKit: ${skError}`);
    return {
      text: '',
      engine: 'none',
      error: `Ошибка Yandex SpeechKit: ${skError}`,
    };
  }
}


