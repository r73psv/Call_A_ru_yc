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
 * Sovereign 152-ФЗ Russian speech-to-text pipeline:
 * Exclusively uses Yandex SpeechKit (Yandex Cloud) - verified domestic Russian STT service.
 * In compliance with the regulation: non-Russian models are prohibited.
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

  if (!isYandexAuthConfigured()) {
    const errorMsg = 'Сервис распознавания речи Yandex SpeechKit не настроен: укажите API-ключ Yandex Cloud в панели управления (раздел «Интеграции & Модели») или установите YC_API_KEY в окружении.';
    log('warning', `[STT] ${errorMsg}`);
    return {
      text: '',
      engine: 'none',
      error: errorMsg
    };
  }

  try {
    log('info', '[STT] Запуск распознавания аудиозаписи через российскую модель Yandex SpeechKit...');
    const skRaw = await transcribeWithRetry(audioBuffer);
    if (skRaw && skRaw.trim().length > 0) {
      const cleaned = fixDuplicatedTranscript(refineTranscriptRoles(skRaw.trim()));
      log('success', `[STT] Речь успешно расшифрована Yandex SpeechKit (${cleaned.length} симв.)`);
      return {
        text: cleaned,
        engine: 'speechkit'
      };
    } else {
      const emptyMsg = 'Yandex SpeechKit вернул пустой результат (в записи отсутствует разборчивая речь или зафиксирована тишина)';
      log('warning', `[STT] ${emptyMsg}`);
      return {
        text: '',
        engine: 'speechkit',
        error: emptyMsg
      };
    }
  } catch (err: any) {
    const errorMsg = err.message || String(err);
    log('error', `[STT] Ошибка распознавания Yandex SpeechKit: ${errorMsg}`);
    return {
      text: '',
      engine: 'speechkit',
      error: errorMsg
    };
  }
}
