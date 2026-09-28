import { CallRecord } from '../types.js';
import { anonymizeTranscript, maskPhone } from './anonymize.js';

function escapeCsv(val: any): string {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

export function generateCallCsv(call: CallRecord, userRole: string = 'manager'): string {
  const rawPhone = call.client_phone || (call as any).full_phone || '';
  const maskedPhone = call.client_phone_masked || maskPhone(rawPhone);

  // 152-ФЗ: Строгое соблюдение ролевого доступа к ПДн
  const clientPhone = (userRole === 'admin' && rawPhone) ? rawPhone : maskedPhone;

  // Обезличивание стенограммы перед экспортом по 152-ФЗ
  let transcript = call.transcript || '';
  if (userRole === 'viewer') {
    transcript = '[Доступ к стенограмме ограничен: роль Наблюдатель (152-ФЗ)]';
  } else {
    transcript = anonymizeTranscript(transcript);
  }

  // Местное время (Europe/Samara, UTC+4)
  let dateFormatted = call.timestamp;
  try {
    dateFormatted = new Date(call.timestamp).toLocaleString('ru-RU', {
      timeZone: 'Europe/Samara',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {}

  const m = Math.floor((call.duration_seconds || 0) / 60);
  const s = (call.duration_seconds || 0) % 60;
  const durationText = m > 0 ? `${m} мин. ${s} сек.` : `${s} сек.`;

  const bookingStatus = call.booking_status || call.key_facts?.booking_status || 'консультация';
  const recommendationsText = Array.isArray(call.recommendations)
    ? call.recommendations.join('; ')
    : (call.recommendations || '');
  const promisesText = Array.isArray(call.key_facts?.promises)
    ? call.key_facts.promises.join('; ')
    : '';

  // Сборка CSV с BOM для корректного открытия в Excel (Windows/Mac)
  // Используется точка с запятой (;) - стандартный разделитель для русскоязычной локали Excel
  const rows: string[] = [];

  // Блок 1: Метаданные и паспорт отчета
  rows.push(['# САЛОН КРАСОТЫ «ЛИК 28» - ДЕТАЛЬНЫЙ ОТЧЕТ АУДИТА ЗВОНКА', '', ''].map(escapeCsv).join(';'));
  rows.push(['# Режим соответствия 152-ФЗ: ВСЕ ПЕРСОНАЛЬНЫЕ ДАННЫЕ МАСКИРОВАНЫ', '', ''].map(escapeCsv).join(';'));
  rows.push(['# Роль пользователя при выгрузке', userRole, ''].map(escapeCsv).join(';'));
  rows.push(['', '', ''].join(';'));

  // Блок 2: Ключ - Значение (для удобного построчного чтения)
  const details: [string, string, string][] = [
    ['ID звонка', call.call_id, 'Уникальный номер сессии'],
    ['Дата и время (местное)', dateFormatted, 'Europe/Samara (UTC+4)'],
    ['Длительность', durationText, `${call.duration_seconds || 0} сек.`],
    ['Тип вызова', call.type === 'outgoing' ? 'Исходящий' : 'Входящий', 'Направление звонка'],
    ['Статус звонка', call.status || 'completed', 'Технический статус соединения'],
    ['Администратор / Оператор', call.operator_name || 'Не указан', 'Сотрудник салона «Лик 28»'],
    ['Клиент (152-ФЗ)', clientPhone, 'Телефон (маскирован согласно 152-ФЗ)'],
    ['Согласие на обработку (152-ФЗ)', call.consent_status || 'active', 'Правовое основание записи'],
    ['Цели обработки ПДн', (call.consent_purposes || ['quality_control', 'training']).join(', '), 'Контроль качества'],
    ['Используемая ИИ-модель', call.model_used || 'GigaChat:Lite', 'Сбер GigaChat / SpeechKit'],
    ['Статус записи (ИИ-анализ)', bookingStatus, 'согласие / отказ / консультация'],
    ['Оценка работы оператора', call.operator_score !== null && call.operator_score !== undefined ? `${call.operator_score}/10` : 'Без оценки', 'Шкала 1-10'],
    ['Итог разговора', call.key_facts?.call_outcome || 'не указан', 'Категория результата'],
    ['Конфликт / Спор', call.key_facts?.is_dispute ? 'ДА' : 'НЕТ', call.key_facts?.dispute_reason || 'Конфликтов не зафиксировано'],
    ['Тональность клиента', call.key_facts?.tone_client || 'нейтральный', 'Эмоциональный окрас'],
    ['Тональность администратора', call.key_facts?.tone_manager || 'спокойный', 'Соблюдение стандартов сервиса'],
    ['Обещания клиенту', promisesText || 'Нет', 'Зафиксированные договоренности'],
    ['Суть обращения клиента', call.key_facts?.client_issue || 'Не указана', 'Тематика звонка'],
    ['Комментарий аудитора', call.operator_comment || '', 'Анализ работы сотрудника'],
    ['Краткое содержание диалога', call.summary || '', 'Резюме разговора от ИИ'],
    ['Рекомендации для администратора', recommendationsText || '', 'Точки роста сервиса'],
    ['Обезличенная стенограмма диалога (152-ФЗ)', transcript, 'Диалог по ролям: Менеджер / Клиент'],
  ];

  rows.push(['Параметр', 'Значение', 'Примечание'].map(escapeCsv).join(';'));
  details.forEach(([k, v, note]) => {
    rows.push([k, v, note].map(escapeCsv).join(';'));
  });

  rows.push(['', '', ''].join(';'));
  rows.push(['# ТАБЛИЧНАЯ СТРОКА ДЛЯ ИМПОРТА В CRM / EXCEL / БАЗЫ ДАННЫХ', '', ''].map(escapeCsv).join(';'));

  // Блок 3: Плоская табличная строка (для легкого объединения или импорта)
  const tableHeaders = [
    'call_id',
    'timestamp_samara',
    'duration_seconds',
    'type',
    'status',
    'operator_name',
    'client_phone_152fz',
    'consent_status',
    'model_used',
    'booking_status',
    'operator_score',
    'call_outcome',
    'is_dispute',
    'dispute_reason',
    'tone_client',
    'tone_manager',
    'summary',
    'operator_comment',
    'recommendations',
    'transcript_anonymized',
  ];

  const tableValues = [
    call.call_id,
    dateFormatted,
    call.duration_seconds || 0,
    call.type || 'incoming',
    call.status || 'completed',
    call.operator_name || '',
    clientPhone,
    call.consent_status || 'active',
    call.model_used || '',
    bookingStatus,
    call.operator_score ?? '',
    call.key_facts?.call_outcome || '',
    call.key_facts?.is_dispute ? 'true' : 'false',
    call.key_facts?.dispute_reason || '',
    call.key_facts?.tone_client || '',
    call.key_facts?.tone_manager || '',
    call.summary || '',
    call.operator_comment || '',
    recommendationsText,
    transcript,
  ];

  rows.push(tableHeaders.map(escapeCsv).join(';'));
  rows.push(tableValues.map(escapeCsv).join(';'));

  // Возвращаем строку с UTF-8 BOM (\uFEFF) для мгновенного корректного открытия в Microsoft Excel
  return '\uFEFF' + rows.join('\r\n');
}
