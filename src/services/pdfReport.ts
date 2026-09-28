import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { CallRecord } from '../types.js';
import { anonymizeTranscript, maskPhone } from './anonymize.js';

function getFontPaths(): { regular: string; bold: string } {
  const localRegular = path.join(process.cwd(), 'fonts', 'LiberationSans-Regular.ttf');
  const localBold = path.join(process.cwd(), 'fonts', 'LiberationSans-Bold.ttf');
  if (fs.existsSync(localRegular) && fs.existsSync(localBold)) {
    return { regular: localRegular, bold: localBold };
  }

  const sysRegular = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf';
  const sysBold = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf';
  if (fs.existsSync(sysRegular) && fs.existsSync(sysBold)) {
    return { regular: sysRegular, bold: sysBold };
  }

  throw new Error('Шрифты с поддержкой кириллицы (LiberationSans) не найдены.');
}

function formatSamaraDate(dateStr?: string): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('ru-RU', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Samara',
    });
  } catch {
    return dateStr;
  }
}

function formatDuration(sec?: number): string {
  if (!sec && sec !== 0) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s} сек.`;
  return `${m} мин. ${s} сек.`;
}

export function generateCallAuditPdf(call: CallRecord, userRole: string = 'manager'): InstanceType<typeof PDFDocument> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 36,
    bufferPages: true,
    info: {
      Title: `Отчет аудита звонка ${call.call_id} — Салон «Лик 28»`,
      Author: 'Салон красоты «Лик 28» — Речевая аналитика GigaChat',
      Subject: 'Отчет контроля качества обслуживания и работы оператора (152-ФЗ)',
    },
  });

  const fonts = getFontPaths();
  doc.registerFont('AppFont', fonts.regular);
  doc.registerFont('AppFontBold', fonts.bold);

  const pageWidth = 595.28;
  const margin = 36;
  const contentWidth = pageWidth - margin * 2; // 523.28

  // Helper function to check and add new page if needed
  function ensureSpace(neededHeight: number) {
    if (doc.y + neededHeight > doc.page.height - margin - 30) {
      doc.addPage();
    }
  }

  // 152-ФЗ Маскирование телефона в зависимости от прав доступа
  const rawPhone = call.client_phone || (call as any).full_phone || '';
  const maskedPhone = call.client_phone_masked || maskPhone(rawPhone);
  const clientPhone = (userRole === 'admin' && rawPhone) ? rawPhone : maskedPhone;

  // 1. Header Banner
  doc.rect(margin, margin, contentWidth, 54).fill('#1e1b4b');
  doc.font('AppFontBold').fontSize(16).fillColor('#ffffff').text('САЛОН КРАСОТЫ «ЛИК 28»', margin + 14, margin + 12);
  doc
    .font('AppFont')
    .fontSize(9)
    .fillColor('#c7d2fe')
    .text('ОТЧЕТ КОНТРОЛЯ КАЧЕСТВА ОБСЛУЖИВАНИЯ И АУДИТА РАБОТЫ ОПЕРАТОРА', margin + 14, margin + 34);

  doc.y = margin + 64;

  // 2. Metadata Sub-strip (152-FZ + generation date)
  const nowSamara = new Date().toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Samara',
  });

  doc.font('AppFont').fontSize(8).fillColor('#64748b');
  doc.text(
    `Дата формирования отчета: ${nowSamara} (Самара, UTC+4)  •  Маскирование 152-ФЗ: Активно  •  Модель: ${call.model_used || 'GigaChat'}`,
    margin,
    doc.y
  );
  doc.moveDown(0.8);

  // 3. Call Parameters Table
  const tableY = doc.y;
  doc.rect(margin, tableY, contentWidth, 68).fillAndStroke('#f8fafc', '#e2e8f0');

  doc.font('AppFontBold').fontSize(8.5).fillColor('#475569');
  doc.text('РЕКВИЗИТЫ ЗВОНКА (МАСКИРОВАНО ПО 152-ФЗ)', margin + 12, tableY + 8);

  doc.font('AppFont').fontSize(8.5).fillColor('#1e293b');
  const col1X = margin + 12;
  const col2X = margin + 180;
  const col3X = margin + 350;

  // Row 1
  doc.font('AppFontBold').text('ID звонка: ', col1X, tableY + 24, { continued: true });
  doc.font('AppFont').text(call.call_id);

  doc.font('AppFontBold').text('Дата и время: ', col2X, tableY + 24, { continued: true });
  doc.font('AppFont').text(formatSamaraDate(call.timestamp));

  doc.font('AppFontBold').text('Длительность: ', col3X, tableY + 24, { continued: true });
  doc.font('AppFont').text(formatDuration(call.duration_seconds));

  // Row 2
  doc.font('AppFontBold').text('Клиент (152-ФЗ): ', col1X, tableY + 44, { continued: true });
  doc.font('AppFont').text(clientPhone);

  doc.font('AppFontBold').text('Администратор: ', col2X, tableY + 44, { continued: true });
  doc.font('AppFont').text(call.operator_name || 'Администратор Лик 28');

  doc.font('AppFontBold').text('Тип вызова: ', col3X, tableY + 44, { continued: true });
  doc.font('AppFont').text(call.type === 'outgoing' ? 'Исходящий' : 'Входящий');

  doc.y = tableY + 76;
  doc.moveDown(0.5);

  // 4. Booking Status & Score Assessment Box
  const rawStatus = (call.booking_status || call.key_facts?.booking_status || '').toLowerCase().trim();
  const isConsent = rawStatus === 'согласие' || rawStatus.includes('соглас') || call.key_facts?.call_outcome === 'запись';
  const isDecline = rawStatus === 'отказ' || rawStatus.includes('отказ') || call.key_facts?.call_outcome === 'отказ';
  const isNA = rawStatus === 'не применимо' || call.key_facts?.call_outcome === 'автоответчик';

  let statusTitle = 'КОНСУЛЬТАЦИЯ (Без записи)';
  let statusDesc = 'Клиент получил информацию об услугах/мастерах салона, слот записи не зафиксирован.';
  let statusBg = '#f0f9ff';
  let statusStroke = '#0ea5e9';
  let statusText = '#0369a1';

  if (isConsent) {
    statusTitle = '✓ СОГЛАСИЕ НА ЗАПИСЬ (Клиент записан)';
    statusDesc = 'Клиент согласился на предложенный слот времени, запись в расписание успешно подтверждена.';
    statusBg = '#ecfdf5';
    statusStroke = '#10b981';
    statusText = '#047857';
  } else if (isDecline) {
    statusTitle = '✗ ОТКАЗ ОТ ЗАПИСИ (Запись не состоялась)';
    statusDesc = 'Клиент отказался от предложенных вариантов (не подходит время, отъезд из города, занятость мастера).';
    statusBg = '#fff1f2';
    statusStroke = '#f43f5e';
    statusText = '#be123c';
  } else if (isNA) {
    statusTitle = '— НЕ ПРИМЕНИМО (Автоответчик / Короткий вызов)';
    statusDesc = 'Соединение не перешло в диалог или сработал автоответчик абонента.';
    statusBg = '#f8fafc';
    statusStroke = '#94a3b8';
    statusText = '#475569';
  }

  ensureSpace(95);
  const assessY = doc.y;
  doc.rect(margin, assessY, contentWidth, 86).fillAndStroke(statusBg, statusStroke);

  // Left side: Booking status
  doc.font('AppFontBold').fontSize(10).fillColor(statusText).text(statusTitle, margin + 14, assessY + 12);
  doc
    .font('AppFont')
    .fontSize(8.5)
    .fillColor('#334155')
    .text(statusDesc, margin + 14, assessY + 28, { width: 340, lineGap: 2 });

  doc.font('AppFontBold').fontSize(8).fillColor('#64748b').text('ИТОГ ОБРАЩЕНИЯ: ', margin + 14, assessY + 64, { continued: true });
  doc.font('AppFontBold').fillColor(statusText).text((call.key_facts?.call_outcome || 'КОНСУЛЬТАЦИЯ').toUpperCase(), { continued: true });
  doc.font('AppFont').fillColor('#64748b').text('  |  Конфликт/спор: ', { continued: true });
  doc.font('AppFontBold').fillColor(call.key_facts?.is_dispute ? '#e11d48' : '#059669').text(
    call.key_facts?.is_dispute ? 'Обнаружен спор' : 'Отсутствует'
  );

  // Right side: Score Badge
  const scoreBoxX = margin + 375;
  const scoreBoxY = assessY + 10;
  const score = call.operator_score;

  let scoreColor = '#10b981';
  let scoreLabel = 'Высокое качество';
  if (score === null || score === undefined) {
    scoreColor = '#94a3b8';
    scoreLabel = 'Без оценки';
  } else if (score < 5) {
    scoreColor = '#ef4444';
    scoreLabel = 'Низкий балл';
  } else if (score < 8) {
    scoreColor = '#f59e0b';
    scoreLabel = 'Средний балл';
  }

  doc.roundedRect(scoreBoxX, scoreBoxY, 134, 66, 6).fillAndStroke('#ffffff', scoreColor);
  doc.font('AppFont').fontSize(7.5).fillColor('#64748b').text('ОЦЕНКА ОПЕРАТОРА', scoreBoxX, scoreBoxY + 8, { align: 'center', width: 134 });
  doc.font('AppFontBold').fontSize(22).fillColor(scoreColor).text(
    score !== null && score !== undefined ? `${score}/10` : '—',
    scoreBoxX,
    scoreBoxY + 20,
    { align: 'center', width: 134 }
  );
  doc.font('AppFont').fontSize(7.5).fillColor(scoreColor).text(scoreLabel, scoreBoxX, scoreBoxY + 48, { align: 'center', width: 134 });

  doc.y = assessY + 96;
  doc.moveDown(0.5);

  // 5. Auditor Comment (Комментарий аудитора)
  if (call.operator_comment) {
    ensureSpace(60);
    const commentY = doc.y;
    doc.rect(margin, commentY, contentWidth, 18).fill('#f1f5f9');
    doc.font('AppFontBold').fontSize(8.5).fillColor('#334155').text('КОММЕНТАРИЙ АУДИТОРА К РАБОТЕ ОПЕРАТОРА', margin + 10, commentY + 5);

    doc.y = commentY + 24;
    doc
      .font('AppFont')
      .fontSize(8.5)
      .fillColor('#1e293b')
      .text(call.operator_comment, margin + 10, doc.y, { width: contentWidth - 20, lineGap: 3 });
    doc.moveDown(0.6);
  }

  // 6. Dialogue Summary (Краткое содержание диалога)
  ensureSpace(70);
  const summaryHeaderY = doc.y;
  doc.rect(margin, summaryHeaderY, contentWidth, 18).fill('#f1f5f9');
  doc.font('AppFontBold').fontSize(8.5).fillColor('#334155').text('КРАТКОЕ СОДЕРЖАНИЕ (РЕЗЮМЕ ОБРАЩЕНИЯ)', margin + 10, summaryHeaderY + 5);

  doc.y = summaryHeaderY + 24;
  doc
    .font('AppFont')
    .fontSize(8.5)
    .fillColor('#1e293b')
    .text(call.summary || 'Резюме диалога отсутствует.', margin + 10, doc.y, { width: contentWidth - 20, lineGap: 3 });
  doc.moveDown(0.6);

  // 7. Recommendations (Рекомендации для администратора)
  const recs = Array.isArray(call.recommendations) ? call.recommendations : [call.recommendations].filter(Boolean);
  if (recs.length > 0) {
    ensureSpace(50);
    const recsHeaderY = doc.y;
    doc.rect(margin, recsHeaderY, contentWidth, 18).fill('#f1f5f9');
    doc.font('AppFontBold').fontSize(8.5).fillColor('#334155').text('РЕКОМЕНДАЦИИ ДЛЯ АДМИНИСТРАТОРА', margin + 10, recsHeaderY + 5);

    doc.y = recsHeaderY + 24;
    recs.forEach((rec, idx) => {
      ensureSpace(24);
      doc
        .font('AppFontBold')
        .fontSize(8.5)
        .fillColor('#4338ca')
        .text(`${idx + 1}. `, margin + 10, doc.y, { continued: true });
      doc
        .font('AppFont')
        .fillColor('#1e293b')
        .text(rec, { width: contentWidth - 30, lineGap: 2 });
      doc.moveDown(0.2);
    });
    doc.moveDown(0.5);
  }

  // 8. Transcript (Стенограмма диалога по ролям с обезличиванием по 152-ФЗ)
  if (userRole === 'viewer') {
    ensureSpace(50);
    const trHeaderY = doc.y;
    doc.rect(margin, trHeaderY, contentWidth, 18).fill('#f1f5f9');
    doc.font('AppFontBold').fontSize(8.5).fillColor('#334155').text('СТЕНОГРАММА ДИАЛОГА', margin + 10, trHeaderY + 5);
    doc.y = trHeaderY + 24;
    doc.font('AppFont').fontSize(8.5).fillColor('#94a3b8').text('[Доступ к стенограмме ограничен правилами 152-ФЗ для роли Наблюдатель]', margin + 10, doc.y);
    doc.moveDown(0.5);
  } else if (call.transcript && call.transcript.trim().length > 0) {
    ensureSpace(70);
    const trHeaderY = doc.y;
    doc.rect(margin, trHeaderY, contentWidth, 18).fill('#f1f5f9');
    doc.font('AppFontBold').fontSize(8.5).fillColor('#334155').text('СТЕНОГРАММА ДИАЛОГА (ОБЕЗЛИЧЕНА ПО 152-ФЗ)', margin + 10, trHeaderY + 5);

    doc.y = trHeaderY + 24;

    const lines = call.transcript.split('\n').map(l => l.trim()).filter(Boolean);
    lines.forEach((line) => {
      ensureSpace(22);
      const isManager = line.startsWith('Менеджер:') || line.startsWith('Администратор:') || line.startsWith('Оператор:');
      const cleanLineRaw = line.replace(/^(Менеджер:|Клиент:|Администратор:|Оператор:|Неизвестный:)\s*/i, '');
      const cleanLine = anonymizeTranscript(cleanLineRaw);
      const speakerLabel = isManager ? 'Менеджер: ' : (line.startsWith('Клиент:') ? 'Клиент: ' : '');

      if (isManager) {
        doc.font('AppFontBold').fontSize(8).fillColor('#4338ca').text(speakerLabel, margin + 10, doc.y, { continued: true });
        doc.font('AppFont').fontSize(8).fillColor('#1e1b4b').text(cleanLine, { width: contentWidth - 25, lineGap: 2 });
      } else {
        doc.font('AppFontBold').fontSize(8).fillColor('#0f172a').text(speakerLabel, margin + 10, doc.y, { continued: true });
        doc.font('AppFont').fontSize(8).fillColor('#334155').text(cleanLine, { width: contentWidth - 25, lineGap: 2 });
      }
      doc.moveDown(0.15);
    });
    doc.moveDown(0.5);
  }

  // 9. Signatures Block (Подпись управляющего)
  ensureSpace(60);
  doc.moveDown(0.8);
  const signY = doc.y;
  doc.rect(margin, signY, contentWidth, 44).fillAndStroke('#f8fafc', '#e2e8f0');

  doc.font('AppFontBold').fontSize(8).fillColor('#475569').text('УТВЕРЖДЕНИЕ ОТЧЕТА УПРАВЛЯЮЩИМ САЛОНА «ЛИК 28»', margin + 12, signY + 8);
  doc.font('AppFont').fontSize(8).fillColor('#334155').text(
    'Управляющий: ________________________ / ________________________            Дата: «____» ________________ 202___ г.',
    margin + 12,
    signY + 25
  );

  // 10. Number all pages & Add Footers
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    const footerY = doc.page.height - margin + 12;
    doc.font('AppFont').fontSize(7.5).fillColor('#94a3b8');
    doc.text(
      `Салон красоты «Лик 28» • Автоматический аудит GigaChat & SpeechKit • Звонок: ${call.call_id}`,
      margin,
      footerY
    );
    doc.text(`Страница ${i + 1} из ${pages.count}`, margin, footerY, {
      align: 'right',
      width: contentWidth,
    });
  }

  return doc;
}
