/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import axios from 'axios';
import https from 'https';
import { getGigaChatToken, isGigaChatConfigured, invalidateGigaChatTokenCache } from './gigachat-auth.js';
import { GigaChatModel, AnalysisResult } from '../types.js';

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

export const SYSTEM_PROMPT = `Ты — ведущий эксперт контроля качества и аналитик звонков салона красоты «Фешен лук студио».
Проанализируй транскрипт телефонного разговора и верни ответ СТРОГО в формате JSON, без текста до и после JSON.

ГЛАВНОЕ ПРАВИЛО: анализируй ТОЛЬКО то, что реально есть в транскрипте. Запрещено выдумывать реплики, факты, имена, услуги и обстоятельства, которых нет в тексте. Если данных нет — фиксируй это явно, а не додумывай.

ШАГ 1. ОПРЕДЕЛИ, СОСТОЯЛСЯ ЛИ РАЗГОВОР (is_conversation)
Разговор СОСТОЯЛСЯ, если в транскрипте есть хотя бы один осмысленный обмен репликами между двумя сторонами (Клиент и Менеджер), даже очень короткий (например: «Когда вы работаете?» — «До 20:00»).
Разговор НЕ состоялся, если диалога между людьми нет: тишина, гудки, сброс, автоответчик, автоинформатор, голосовая почта, обрыв, «абонент не ответил», либо реплики только одной стороны без ответа.
ВАЖНО: длительность звонка — вспомогательный признак, а НЕ решающий. Ориентируйся на СОДЕРЖАНИЕ текста, а не на секунды:
- Короткий звонок (10–60 секунд) с 1–2 реальными репликами — это СОСТОЯВШИЙСЯ разговор. НЕ пиши «разговор не состоялся».
- Звонок от минуты и больше с реальным диалогом — тем более состоявшийся разговор.
- Считай разговор несостоявшимся ТОЛЬКО если диалога в тексте нет вообще.

ШАГ 2. РАЗДЕЛИ РЕПЛИКИ ПО РОЛЯМ
- Только две роли: «Менеджер» (администратор салона) и «Клиент» (звонящий).
- Каждая реплика — в формате 'Роль: Текст', с новой строки.
- Категорически запрещено склеивать реплики разных говорящих в одну строку — разделяй их.
- Ничего не добавляй от себя.
- Если разговор не состоялся, запиши в formatted_transcript ровно: 'Разговор не состоялся (диалог отсутствует)'.

ШАГ 3. СТАТУС ЗАПИСИ (booking_status) — ровно одно значение:
- "согласие" — клиент подтвердил запись (названы услуга, и/или мастер, и/или время);
- "отказ" — клиент отказался от записи или предложенного времени (не подходит слот, не будет в городе, дорого, передумал и т.п.);
- "консультация" — клиент получил только справочную информацию без записи;
- "не применимо" — разговор не состоялся.

ШАГ 4. РЕЗЮМЕ (transcript_summary) — 2–4 предложения, вся цепочка:
а) запрос клиента (мастер, услуга, желаемые дата/время);
б) что предложил администратор (слоты, альтернативные мастера);
в) ОБЯЗАТЕЛЬНЫЙ финальный вывод: чем закончилось — согласие, отказ (с конкретной причиной) или консультация. Резюме нельзя обрывать без фиксации итога.
Если разговор не состоялся: 'Разговор не состоялся: диалог отсутствует.'

ШАГ 5. КЛЮЧЕВЫЕ ФАКТЫ (key_facts)
- is_dispute, dispute_reason;
- tone_client, tone_manager: "нейтральный|позитивный|негативный";
- call_outcome — ровно одно значение:
  * "запись" — запись подтверждена;
  * "отказ" — клиент отказался от записи;
  * "консультация" — только информация, без записи;
  * "перезвон" — договорились созвониться позже;
  * "отмена" — клиент отменил существующую запись;
  * "не состоялся" — диалога не было (тишина, гудки, сброс, автоответчик, автоинформатор).
- booking_status — строго дублирует значение из Шага 3;
- client_issue — конкретная суть обращения.

ШАГ 6. ОЦЕНКА ОПЕРАТОРА (operator_score)
- Оценку (целое от 1 до 10) ставь ТОЛЬКО если разговор состоялся (is_conversation = true).
- Если разговор не состоялся — operator_score СТРОГО null (не 0 и не число).
- operator_comment: при состоявшемся разговоре — краткий комментарий по работе администратора; при несостоявшемся — 'Разговор не состоялся (диалог отсутствует).'
- recommendations: конкретные советы администратору; при несостоявшемся — 'Повторить попытку дозвона клиенту в рабочее время салона «Фешен лук студио».'

РЕГЛАМЕНТ САЛОНА
- Официальное название: «Фешен лук студио». Приветствие с этим названием — норма, оценку за него не снижай.
- Не выдумывай факты, фразы и обстоятельства, которых нет в стенограмме.

ФОРМАТ ОТВЕТА (JSON, без пояснений вне JSON):
{
  "is_conversation": true | false,
  "transcript_summary": "...",
  "booking_status": "согласие|отказ|консультация|не применимо",
  "formatted_transcript": "Менеджер: ...\\nКлиент: ...",
  "key_facts": {
    "is_dispute": false,
    "dispute_reason": null,
    "tone_client": "нейтральный|позитивный|негативный",
    "tone_manager": "нейтральный|позитивный|негативный",
    "call_outcome": "запись|отказ|консультация|перезвон|отмена|не состоялся",
    "booking_status": "согласие|отказ|консультация|не применимо",
    "client_issue": "..."
  },
  "operator_score": 1-10 | null,
  "operator_comment": "...",
  "recommendations": "..."
}`;


// ============================================================
// БАЗОВЫЕ ПРИМЕРЫ (few-shot)
// ============================================================
export const FEW_SHOT_EXAMPLES = `
ПРИМЕР 1 (пустой звонок, диалога нет)
Транскрипт: "[тишина] [гудки] [сброс]" (длительность 5 сек)
Ответ:
{
  "is_conversation": false,
  "transcript_summary": "Разговор не состоялся: диалог отсутствует.",
  "booking_status": "не применимо",
  "formatted_transcript": "Разговор не состоялся (диалог отсутствует)",
  "key_facts": {
    "is_dispute": false,
    "dispute_reason": null,
    "tone_client": "нейтральный",
    "tone_manager": "нейтральный",
    "call_outcome": "не состоялся",
    "booking_status": "не применимо",
    "client_issue": null
  },
  "operator_score": null,
  "operator_comment": "Разговор не состоялся (диалог отсутствует).",
  "recommendations": "Повторить попытку дозвона клиенту в рабочее время салона «Фешен лук студио»."
}

ПРИМЕР 2 (автоответчик / автоинформатор)
Транскрипт: "Здравствуйте, вы позвонили в салон. Оставьте сообщение после сигнала." (длительность 8 сек)
Ответ:
{
  "is_conversation": false,
  "transcript_summary": "Разговор не состоялся: диалог отсутствует.",
  "booking_status": "не применимо",
  "formatted_transcript": "Разговор не состоялся (диалог отсутствует)",
  "key_facts": {
    "is_dispute": false,
    "dispute_reason": null,
    "tone_client": "нейтральный",
    "tone_manager": "нейтральный",
    "call_outcome": "не состоялся",
    "booking_status": "не применимо",
    "client_issue": null
  },
  "operator_score": null,
  "operator_comment": "Разговор не состоялся (диалог отсутствует).",
  "recommendations": "Повторить попытку дозвона клиенту в рабочее время салона «Лик 28»."
}

ПРИМЕР 3 (короткий, но состоявшийся разговор 20 сек — консультация)
Транскрипт: "Менеджер: Салон «Фешен лук студио», добрый день. Клиент: До скольки вы работаете сегодня? Менеджер: До 20:00. Клиент: Спасибо." (длительность 20 сек)
Ответ:
{
  "is_conversation": true,
  "transcript_summary": "Клиент уточнил график работы салона на сегодня. Администратор ответил, что салон работает до 20:00. Клиент поблагодарил и завершил разговор — запись не оформлялась, это консультация.",
  "booking_status": "консультация",
  "formatted_transcript": "Менеджер: Салон «Лик 28», добрый день.\\nКлиент: До скольки вы работаете сегодня?\\nМенеджер: До 20:00.\\nКлиент: Спасибо.",
  "key_facts": {
    "is_dispute": false,
    "dispute_reason": null,
    "tone_client": "нейтральный",
    "tone_manager": "нейтральный",
    "call_outcome": "консультация",
    "booking_status": "консультация",
    "client_issue": "Уточнение графика работы салона"
  },
  "operator_score": 8,
  "operator_comment": "Администратор чётко и быстро ответил на вопрос клиента.",
  "recommendations": "Предложить клиенту записаться на услугу, пока он на линии."
}

ПРИМЕР 4 (состоявшийся разговор — согласие на запись)
Транскрипт: "Менеджер: Салон «Фешен лук студио», добрый день. Клиент: Здравствуйте, хочу записаться на маникюр к Анне. Менеджер: Анна свободна завтра в 15:00, вам удобно? Клиент: Да, отлично, записывайте. Менеджер: Записала вас на завтра, 15:00, к Анне. Клиент: Спасибо." (длительность 55 сек)
Ответ:
{
  "is_conversation": true,
  "transcript_summary": "Клиент хотел записаться на маникюр к мастеру Анне. Администратор предложил слот завтра в 15:00. Клиент согласился, запись подтверждена на маникюр к Анне завтра в 15:00.",
  "booking_status": "согласие",
  "formatted_transcript": "Менеджер: Салон «Лик 28», добрый день.\\nКлиент: Здравствуйте, хочу записаться на маникюр к Анне.\\nМенеджер: Анна свободна завтра в 15:00, вам удобно?\\nКлиент: Да, отлично, записывайте.\\nМенеджер: Записала вас на завтра, 15:00, к Анне.\\nКлиент: Спасибо.",
  "key_facts": {
    "is_dispute": false,
    "dispute_reason": null,
    "tone_client": "позитивный",
    "tone_manager": "позитивный",
    "call_outcome": "запись",
    "booking_status": "согласие",
    "client_issue": "Запись на маникюр к мастеру Анне"
  },
  "operator_score": 9,
  "operator_comment": "Администратор вежливо предложил конкретный слот и подтвердил запись.",
  "recommendations": "Напомнить клиенту о визите за день до записи."
}

ПРИМЕР 5 (состоявшийся разговор — отказ)
Транскрипт: "Менеджер: Салон «Фешен лук студио», добрый день. Клиент: Хочу стрижку на выходных. Менеджер: На выходных есть суббота в 12:00. Клиент: Нет, я буду в отъезде, не подходит. Менеджер: Хорошо, звоните. Клиент: До свидания." (длительность 48 сек)
Ответ:
{
  "is_conversation": true,
  "transcript_summary": "Клиент хотел записаться на стрижку на выходные. Администратор предложил субботу в 12:00, но клиент отказался, так как будет в отъезде. Запись не оформлена — отказ из-за неудобного времени.",
  "booking_status": "отказ",
  "formatted_transcript": "Менеджер: Салон «Лик 28», добрый день.\\nКлиент: Хочу стрижку на выходных.\\nМенеджер: На выходных есть суббота в 12:00.\\nКлиент: Нет, я буду в отъезде, не подходит.\\nМенеджер: Хорошо, звоните.\\nКлиент: До свидания.",
  "key_facts": {
    "is_dispute": false,
    "dispute_reason": null,
    "tone_client": "нейтральный",
    "tone_manager": "нейтральный",
    "call_outcome": "отказ",
    "booking_status": "отказ",
    "client_issue": "Запись на стрижку на выходные"
  },
  "operator_score": 6,
  "operator_comment": "Администратор предложил только один слот и не предложил альтернативы.",
  "recommendations": "Предлагать 2–3 варианта времени и альтернативных мастеров, чтобы удержать клиента."
}

ПРИМЕР 6 (состоявшийся разговор — договорились о перезвоне)
Транскрипт: "Менеджер: Салон «Фешен лук студио», добрый день. Клиент: Хочу записаться на окрашивание, но не знаю, когда освобожусь. Менеджер: Давайте я вам позвоню завтра утром? Клиент: Да, удобно, после 10:00." (длительность 40 сек)
Ответ:
{
  "is_conversation": true,
  "transcript_summary": "Клиент хотел записаться на окрашивание, но не определился со временем. Администратор договорился созвониться завтра утром. Итог — перезвон, запись пока не оформлена.",
  "booking_status": "консультация",
  "formatted_transcript": "Менеджер: Салон «Фешен лук студио», добрый день.\\nКлиент: Хочу записаться на окрашивание, но не знаю, когда освобожусь.\\nМенеджер: Давайте я вам позвоню завтра утром?\\nКлиент: Да, удобно, после 10:00.",
  "key_facts": {
    "is_dispute": false,
    "dispute_reason": null,
    "tone_client": "нейтральный",
    "tone_manager": "позитивный",
    "call_outcome": "перезвон",
    "booking_status": "консультация",
    "client_issue": "Запись на окрашивание, время не определено"
  },
  "operator_score": 8,
  "operator_comment": "Администратор взял инициативу и договорился о повторном звонке.",
  "recommendations": "Зафиксировать перезвон в CRM и не забыть позвонить после 10:00."
}
`;


// ============================================================
// «ПРОВОКАЦИОННЫЕ» ПРИМЕРЫ (edge cases)
// ============================================================
export const FEW_SHOT_EDGE_CASES = `
ПРИМЕР 7 (провокация: очень короткий, но РЕАЛЬНЫЙ обмен — 12 сек)
Транскрипт: "Менеджер: Салон «Фешен лук студио». Клиент: Сколько стоит педикюр? Менеджер: От 1800 рублей. Клиент: Понял, спасибо." (длительность 12 сек)
Ответ:
{
  "is_conversation": true,
  "transcript_summary": "Клиент уточнил стоимость педикюра. Администратор назвал цену — от 1800 рублей. Клиент поблагодарил и завершил разговор; запись не оформлялась, это консультация.",
  "booking_status": "консультация",
  "formatted_transcript": "Менеджер: Салон «Фешен лук студио».\\nКлиент: Сколько стоит педикюр?\\nМенеджер: От 1800 рублей.\\nКлиент: Понял, спасибо.",
  "key_facts": {
    "is_dispute": false,
    "dispute_reason": null,
    "tone_client": "нейтральный",
    "tone_manager": "нейтральный",
    "call_outcome": "консультация",
    "booking_status": "консультация",
    "client_issue": "Уточнение стоимости педикюра"
  },
  "operator_score": 8,
  "operator_comment": "Администратор быстро и чётко назвал цену.",
  "recommendations": "После ответа о цене предложить клиенту записаться."
}

ПРИМЕР 8 (провокация: коротко, но диалога НЕТ — говорит только менеджер)
Транскрипт: "Менеджер: Алло, салон «Фешен лук студио», слушаю вас. [тишина] Менеджер: Алло? [сброс]" (длительность 9 сек)
Ответ:
{
  "is_conversation": false,
  "transcript_summary": "Разговор не состоялся: диалог отсутствует.",
  "booking_status": "не применимо",
  "formatted_transcript": "Разговор не состоялся (диалог отсутствует)",
  "key_facts": {
    "is_dispute": false,
    "dispute_reason": null,
    "tone_client": "нейтральный",
    "tone_manager": "нейтральный",
    "call_outcome": "не состоялся",
    "booking_status": "не применимо",
    "client_issue": null
  },
  "operator_score": null,
  "operator_comment": "Разговор не состоялся (диалог отсутствует).",
  "recommendations": "Повторить попытку дозвона клиенту в рабочее время салона «Лик 28»."
}

ПРИМЕР 9 (провокация: длинный звонок, но диалог ОДНОСТОРОННИЙ — только менеджер)
Транскрипт: "Менеджер: Салон «Фешен лук студио», добрый день. Вы позвонили по вопросу записи. Оставьте, пожалуйста, ваше имя и номер. Спасибо за звонок, до свидания." (длительность 42 сек, ответа клиента нет)
Ответ:
{
  "is_conversation": false,
  "transcript_summary": "Разговор не состоялся: диалог отсутствует.",
  "booking_status": "не применимо",
  "formatted_transcript": "Разговор не состоялся (диалог отсутствует)",
  "key_facts": {
    "is_dispute": false,
    "dispute_reason": null,
    "tone_client": "нейтральный",
    "tone_manager": "нейтральный",
    "call_outcome": "не состоялся",
    "booking_status": "не применимо",
    "client_issue": null
  },
  "operator_score": null,
  "operator_comment": "Разговор не состоялся (диалог отсутствует).",
  "recommendations": "Повторить попытку дозвона клиенту в рабочее время салона «Лик 28»."
}

ПРИМЕР 10 (провокация: звонок больше минуты — модель не должна писать «не состоялся»)
Транскрипт: "Менеджер: Салон «Фешен лук студио», добрый день. Клиент: Здравствуйте, хотела бы записаться на стрижку и укладку. Менеджер: Когда вам удобно? Клиент: Лучше в пятницу после работы. Менеджер: В пятницу есть 18:30 у мастера Ольги и 19:00 у Елены. Клиент: 18:30 подойдёт. Менеджер: Записала вас на пятницу, 18:30, к Ольге на стрижку и укладку. Клиент: Отлично, спасибо большое." (длительность 95 сек)
Ответ:
{
  "is_conversation": true,
  "transcript_summary": "Клиент хотела записаться на стрижку и укладку, удобное время — пятница после работы. Администратор предложил 18:30 у Ольги и 19:00 у Елены. Клиент выбрала 18:30, запись подтверждена на пятницу к Ольге на стрижку и укладку.",
  "booking_status": "согласие",
  "formatted_transcript": "Менеджер: Салон «Лик 28», добрый день.\\nКлиент: Здравствуйте, хотела бы записаться на стрижку и укладку.\\nМенеджер: Когда вам удобно?\\nКлиент: Лучше в пятницу после работы.\\nМенеджер: В пятницу есть 18:30 у мастера Ольги и 19:00 у Елены.\\nКлиент: 18:30 подойдёт.\\nМенеджер: Записала вас на пятницу, 18:30, к Ольге на стрижку и укладку.\\nКлиент: Отлично, спасибо большое.",
  "key_facts": {
    "is_dispute": false,
    "dispute_reason": null,
    "tone_client": "позитивный",
    "tone_manager": "позитивный",
    "call_outcome": "запись",
    "booking_status": "согласие",
    "client_issue": "Запись на стрижку и укладку к мастеру Ольге"
  },
  "operator_score": 10,
  "operator_comment": "Администратор предложил два варианта времени и чётко подтвердил запись.",
  "recommendations": "Напомнить клиенту о визите за день до записи."
}

ПРИМЕР 11 (провокация: автоинформатор + короткий реальный диалог в одном звонке)
Транскрипт: "Автоинформатор: Ваш звонок очень важен для нас, соединяем с оператором. Менеджер: Салон «Лик 28», слушаю. Клиент: Мне бы записаться на коррекцию бровей. Менеджер: Есть сегодня в 17:00, подойдёт? Клиент: Да, давайте." (длительность 35 сек)
Ответ:
{
  "is_conversation": true,
  "transcript_summary": "После автоинформатора клиент дозвонился до администратора и попросил записать его на коррекцию бровей. Администратор предложил сегодня в 17:00, клиент согласился. Запись подтверждена на коррекцию бровей сегодня в 17:00.",
  "booking_status": "согласие",
  "formatted_transcript": "Менеджер: Салон «Фешен лук студио», слушаю.\\nКлиент: Мне бы записаться на коррекцию бровей.\\nМенеджер: Есть сегодня в 17:00, подойдёт?\\nКлиент: Да, давайте.",
  "key_facts": {
    "is_dispute": false,
    "dispute_reason": null,
    "tone_client": "нейтральный",
    "tone_manager": "нейтральный",
    "call_outcome": "запись",
    "booking_status": "согласие",
    "client_issue": "Запись на коррекцию бровей"
  },
  "operator_score": 9,
  "operator_comment": "Администратор предложил конкретное время и подтвердил запись.",
  "recommendations": "Уточнять у клиента, нужен ли конкретный мастер."
}
`;


/**
 * Собирает пользовательскую часть промпта: примеры + транскрипт + длительность.
 * Системная часть (SYSTEM_PROMPT) передаётся отдельным сообщением с ролью 'system'.
 */
export const buildUserPrompt = (transcript: string, callDurationSeconds?: number): string => {
  const durationLine =
    callDurationSeconds !== undefined
      ? `Фактическая длительность звонка: ${callDurationSeconds} сек. (вспомогательный признак — решает СОДЕРЖАНИЕ диалога).\n`
      : '';
  return `ПРИМЕРЫ ПРАВИЛЬНЫХ ОТВЕТОВ (ориентируйся на них по структуре и логике):
${FEW_SHOT_EXAMPLES}
${FEW_SHOT_EDGE_CASES}

ТРАНСКРИПТ ЗВОНКА:
${durationLine}${transcript}`;
};

/**
 * Программная проверка согласованности ответа модели.
 * Ловит две основные ошибки: оценку при несостоявшемся звонке и статус «не состоялся» при реальном диалоге.
 */
export function validateResult(result: AnalysisResult): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const notHappened =
    result.key_facts.call_outcome === 'не состоялся' || result.booking_status === 'не применимо';

  if (notHappened) {
    if (result.operator_score !== null) {
      errors.push('Звонок не состоялся, но operator_score не null');
    }
    if (result.booking_status !== 'не применимо') {
      errors.push('Звонок не состоялся, но booking_status не "не применимо"');
    }
    if (result.key_facts.call_outcome !== 'не состоялся') {
      errors.push('Звонок не состоялся, но call_outcome не "не состоялся"');
    }
  } else {
    if (typeof result.operator_score !== 'number') {
      errors.push('Разговор состоялся, но operator_score не число');
    }
    if (result.booking_status === 'не применимо') {
      errors.push('Разговор состоялся, но booking_status = "не применимо"');
    }
  }

  if (result.booking_status !== result.key_facts.booking_status) {
    errors.push('booking_status не совпадает с key_facts.booking_status');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Очередь запросов к GigaChat (FIFO) с ограничением параллелизма = 1.
 * Гарантирует, что к GigaChat идёт не более 1 запроса одновременно,
 * а остальные запросы последовательно ожидают в очереди.
 */
interface QueueTask<T> {
  id: string;
  description: string;
  fn: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
  enqueuedAt: number;
}

export class GigaChatQueue {
  private queue: QueueTask<any>[] = [];
  private isProcessing = false;
  private currentTaskId: string | null = null;
  private totalProcessed = 0;
  private minIntervalMs = 400; // Минимальная пауза между запросами (защита от burst-лимитов)
  private lastRequestEndTime = 0;

  /**
   * Добавляет асинхронную задачу в очередь FIFO.
   */
  public enqueue<T>(fn: () => Promise<T>, description = 'Запрос к GigaChat'): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = `giga-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const task: QueueTask<T> = {
        id,
        description,
        fn,
        resolve,
        reject,
        enqueuedAt: Date.now(),
      };

      this.queue.push(task);
      const position = this.queue.length;

      if (this.isProcessing) {
        console.log(`[GigaChat Очередь] «${description}» [${id}] добавлен в очередь (позиция: ${position})`);
      }

      this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const item = this.queue.shift()!;
    this.currentTaskId = item.id;
    const waitTimeMs = Date.now() - item.enqueuedAt;

    try {
      // Соблюдение минимального интервала между последовательными запросами
      const elapsedSinceLast = Date.now() - this.lastRequestEndTime;
      if (this.lastRequestEndTime > 0 && elapsedSinceLast < this.minIntervalMs) {
        await new Promise(r => setTimeout(r, this.minIntervalMs - elapsedSinceLast));
      }

      if (waitTimeMs > 150) {
        console.log(`[GigaChat Очередь] Выполнение [${item.id}] «${item.description}» (ожидание в очереди: ${waitTimeMs} мс, осталось: ${this.queue.length})`);
      }

      const result = await item.fn();
      this.totalProcessed++;
      item.resolve(result);
    } catch (err) {
      item.reject(err);
    } finally {
      this.lastRequestEndTime = Date.now();
      this.currentTaskId = null;
      this.isProcessing = false;
      // Переход к следующему элементу в очереди
      setImmediate(() => this.processNext());
    }
  }

  public getStatus() {
    return {
      pending: this.queue.length,
      isProcessing: this.isProcessing,
      currentTaskId: this.currentTaskId,
      totalProcessed: this.totalProcessed,
    };
  }
}

export const gigaChatQueue = new GigaChatQueue();

export function getGigaChatQueueStatus() {
  return gigaChatQueue.getStatus();
}

const MAX_RETRIES = 4;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 32000;

export type GigaChatLogCallback = (
  type: 'info' | 'warning' | 'error' | 'success',
  message: string
) => void;

/**
 * Выполняет анализ через GigaChat с очередью FIFO (параллелизм = 1)
 * и экспоненциальной задержкой retry (особенно при ошибках 429 Too Many Requests).
 */
export async function analyzeWithRetry(
  transcript: string,
  model?: GigaChatModel,
  onLog?: GigaChatLogCallback,
  callDurationSeconds?: number
): Promise<AnalysisResult> {
  const modelName = model || 'GigaChat:Lite';
  return gigaChatQueue.enqueue(async () => {
    return executeWithExponentialBackoff(transcript, modelName, onLog, callDurationSeconds);
  }, `Анализ транскрипта (${modelName})`);
}

async function executeWithExponentialBackoff(
  transcript: string,
  model: GigaChatModel,
  onLog?: GigaChatLogCallback,
  callDurationSeconds?: number
): Promise<AnalysisResult> {
  let lastError: any = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await analyzeWithGigaChat(transcript, model, callDurationSeconds);
    } catch (error: any) {
      lastError = error;
      const status = error.response?.status;
      const responseData = error.response?.data;
      const responseMsg = responseData?.message || responseData?.description || error.message || String(error);

      // Проверка на ошибку лимита 429 (Too Many Requests / Rate Limit)
      const is429 = status === 429 ||
        /429|too many requests|rate limit|queries per second|quota exceeded/i.test(responseMsg);

      // При ошибках аутентификации 401/403 сбрасываем кэш токена
      if (status === 401 || status === 403) {
        invalidateGigaChatTokenCache();
        console.warn(`[GigaChat] Ошибка авторизации (HTTP ${status}). Сброс токена и повторная авторизация...`);
      }

      console.error(
        `[GigaChat] Попытка ${attempt}/${MAX_RETRIES} завершилась ошибкой (HTTP ${status || 'ERR'}): ${responseMsg}`
      );

      if (attempt < MAX_RETRIES) {
        // Экспоненциальная задержка: 2s, 4s, 8s, 16s...
        const expDelay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), MAX_DELAY_MS);

        // Проверка заголовка Retry-After (если предоставлен сервисом Сбера в секундах)
        let retryAfterMs = 0;
        const retryHeader = error.response?.headers?.['retry-after'];
        if (retryHeader) {
          const parsedSeconds = parseInt(retryHeader, 10);
          if (!isNaN(parsedSeconds) && parsedSeconds > 0) {
            retryAfterMs = parsedSeconds * 1000;
          }
        }

        // Небольшой случайный джиттер (±10%) для устранения резонансных всплесков
        const jitter = Math.floor(Math.random() * (expDelay * 0.2)) - (expDelay * 0.1);
        const finalDelay = Math.max(1000, Math.max(expDelay + jitter, retryAfterMs));
        const delaySec = (finalDelay / 1000).toFixed(1);

        if (is429) {
          const logMsg = `GigaChat: превышен лимит запросов (HTTP 429 Too Many Requests). Экспоненциальная пауза ${delaySec} сек перед повтором (попытка ${attempt}/${MAX_RETRIES})...`;
          console.warn(`[GigaChat RateLimit 429] ${logMsg}`);
          if (onLog) onLog('warning', logMsg);
        } else {
          const logMsg = `GigaChat: временный сбой (${responseMsg}). Повтор через ${delaySec} сек (попытка ${attempt}/${MAX_RETRIES})...`;
          console.log(`[GigaChat Retry] ${logMsg}`);
          if (onLog) onLog('warning', logMsg);
        }

        await new Promise(r => setTimeout(r, finalDelay));
      }
    }
  }

  const failMsg = `GigaChat недоступен после ${MAX_RETRIES} попыток: ${lastError?.message || lastError}`;
  console.error(`[GigaChat] ${failMsg}`);
  if (onLog) onLog('error', failMsg);
  throw new Error(failMsg);
}


export async function analyzeWithGigaChat(
  transcript: string,
  modelOverride?: GigaChatModel,
  callDurationSeconds?: number
): Promise<AnalysisResult> {
  const model: GigaChatModel = modelOverride || (process.env.GIGACHAT_DEFAULT_MODEL as GigaChatModel) || 'GigaChat:Lite';

  // Жёсткий предохранитель: при длительности менее 10 секунд LLM не вызываем —
  // возвращаем результат «разговор не состоялся», чтобы исключить фантазии модели.
  if (callDurationSeconds !== undefined && callDurationSeconds < 10) {
    return generateLocalFallbackAnalysis(transcript, model, callDurationSeconds);
  }

  if (!isGigaChatConfigured()) {
    // Если GigaChat не настроен — возвращаем локальный резервный анализ.
    return generateLocalFallbackAnalysis(transcript, model, callDurationSeconds);
  }

  const token = await getGigaChatToken();
  console.log(`[GigaChat] Анализ моделью: ${model} (длительность звонка: ${callDurationSeconds ?? 'не указана'} сек.)`);

  const gigachatApiUrl = process.env.GIGACHAT_API_URL || 'https://gigachat.devices.sberbank.ru/api/v1/chat/completions';

  // Системная часть — правила; пользовательская — примеры + транскрипт + длительность.
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(transcript, callDurationSeconds) },
  ];

  const res = await axios.post(
    gigachatApiUrl,
    {
      model,
      messages,
      temperature: 0.1, // Низкая температура против «фантазирования»
      max_tokens: 2000,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      httpsAgent,
      timeout: 60000,
    }
  );

  const rawContent = res.data.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error('GigaChat вернул пустой ответ');
  }

  // Пытаемся распарсить JSON, при неудаче — просим модель исправить формат.
  try {
    return parseGigaChatJson(rawContent);
  } catch (parseErr) {
    console.warn('[GigaChat] Первый парсинг JSON не удался, отправка запроса на исправление формата...');
    const retryRes = await axios.post(
      gigachatApiUrl,
      {
        model,
        messages: [
          ...messages,
          { role: 'assistant', content: rawContent },
          { role: 'user', content: 'Верни только валидный JSON без пояснений и markdown-обёрток.' },
        ],
        temperature: 0.1,
        max_tokens: 2000,
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        httpsAgent,
        timeout: 30000,
      }
    );

    const retryContent = retryRes.data.choices?.[0]?.message?.content || '';
    return parseGigaChatJson(retryContent);
  }
}

/**
 * Разбирает ответ модели, опираясь на явные поля (is_conversation, call_outcome, booking_status),
 * а не на хрупкий поиск ключевых слов. Возвращает согласованный AnalysisResult.
 */
function parseGigaChatJson(text: string): AnalysisResult {
  // Убираем markdown-обёртки, если они есть
  let clean = text.trim();
  if (clean.startsWith('```json')) {
    clean = clean.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (clean.startsWith('```')) {
    clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }

  const jsonMatch = clean.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    clean = jsonMatch[0];
  }

  const parsed = JSON.parse(clean);

  const formattedTranscript =
    typeof parsed.formatted_transcript === 'string' && parsed.formatted_transcript.trim().length > 0
      ? parsed.formatted_transcript.trim()
      : undefined;

  const rawOutcome = String(parsed.key_facts?.call_outcome || '').toLowerCase().trim();
  const rawBooking = String(parsed.booking_status || parsed.key_facts?.booking_status || '').toLowerCase().trim();

  // Признак реального диалога: в стенограмме присутствуют обе роли.
  const transcriptHasBothRoles =
    !!formattedTranscript &&
    /менеджер\s*:/i.test(formattedTranscript) &&
    /клиент\s*:/i.test(formattedTranscript);

  // --- Определяем, состоялся ли разговор (главный переключатель) ---
  let isConversation: boolean;
  if (typeof parsed.is_conversation === 'boolean') {
    isConversation = parsed.is_conversation;
  } else if (rawOutcome === 'не состоялся' || rawOutcome === 'автоответчик' || rawBooking === 'не применимо') {
    isConversation = false;
  } else if (rawOutcome || rawBooking) {
    isConversation = true;
  } else {
    isConversation = transcriptHasBothRoles;
  }

  // Явные маркеры провала перекрывают вердикт, но ТОЛЬКО если в стенограмме нет обеих ролей.
  const combinedText = `${formattedTranscript || ''} ${parsed.transcript_summary || ''} ${parsed.summary || ''}`.toLowerCase();
  const explicitFailure =
    /разговор не состоялся|звонок не состоялся|автоответчик|автоинформатор|голосовая почта|оставьте сообщение|после сигнала|абонент временно недоступен|абонент занят|все операторы заняты/.test(combinedText);
  if (explicitFailure && !transcriptHasBothRoles) {
    isConversation = false;
  }

  // --- Ветка «разговор не состоялся» ---
  if (!isConversation) {
    return {
      transcript_summary: 'Разговор не состоялся: диалог отсутствует (тишина, гудки, сброс, автоответчик или автоинформатор).',
      booking_status: 'не применимо',
      formatted_transcript: formattedTranscript || 'Разговор не состоялся (диалог отсутствует)',
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'не состоялся',
        booking_status: 'не применимо',
        client_issue: null,
      },
      operator_score: null,
      operator_comment: 'Разговор не состоялся (диалог отсутствует).',
      recommendations: 'Повторить попытку дозвона клиенту в рабочее время салона «Лик 28».',
    };
  }

  // --- Ветка «разговор состоялся»: нормализация полей ---
  let bookingStatus = rawBooking;
  if (!['согласие', 'отказ', 'консультация'].includes(bookingStatus)) {
    if (bookingStatus.includes('соглас') || rawOutcome === 'запись') {
      bookingStatus = 'согласие';
    } else if (bookingStatus.includes('отказ') || rawOutcome === 'отказ') {
      bookingStatus = 'отказ';
    } else {
      bookingStatus = 'консультация';
    }
  }

  const validOutcomes = ['запись', 'отказ', 'консультация', 'перезвон', 'отмена'];
  let outcome = validOutcomes.includes(rawOutcome) ? rawOutcome : 'консультация';
  if (bookingStatus === 'согласие') {
    outcome = 'запись';
  } else if (bookingStatus === 'отказ' && outcome !== 'отмена') {
    outcome = 'отказ';
  }

  let score: number | null = null;
  if (typeof parsed.operator_score === 'number' && !isNaN(parsed.operator_score)) {
    score = Math.max(1, Math.min(10, Math.round(parsed.operator_score)));
  }
  // Модель забыла оценку, но разговор реальный — ставим нейтральную 7, чтобы не было null.
  if (score === null) {
    score = 7;
  }

  const summary =
    parsed.transcript_summary || parsed.summary || 'Краткое содержание диалога с результатом обращения.';
  const comment =
    parsed.operator_comment && parsed.operator_comment.trim().length > 0
      ? parsed.operator_comment
      : 'Администратор обработал обращение по регламенту салона «Лик 28».';
  const recommendations = parsed.recommendations || 'Соблюдать стандарты сервиса салона «Лик 28».';

  const result: AnalysisResult = {
    transcript_summary: summary,
    booking_status: bookingStatus,
    formatted_transcript: formattedTranscript,
    key_facts: {
      is_dispute: Boolean(parsed.key_facts?.is_dispute),
      dispute_reason: parsed.key_facts?.dispute_reason || null,
      tone_client: parsed.key_facts?.tone_client || 'нейтральный',
      tone_manager: parsed.key_facts?.tone_manager || 'нейтральный',
      call_outcome: outcome,
      booking_status: bookingStatus,
      client_issue: parsed.key_facts?.client_issue || 'Обращение в салон «Лик 28»',
    },
    operator_score: score,
    operator_comment: comment,
    recommendations: recommendations,
  };

  // Программная проверка согласованности — только логируем расхождения.
  const check = validateResult(result);
  if (!check.valid) {
    console.warn(`[GigaChat] Обнаружены несоответствия в ответе модели: ${check.errors.join('; ')}`);
  }

  return result;
}


function generateLocalFallbackAnalysis(
  transcript: string,
  model: GigaChatModel,
  callDurationSeconds?: number
): AnalysisResult {
  const clean = (transcript || '').trim();
  const lower = clean.toLowerCase();

  // 1. Жёсткий предохранитель: звонки менее 10 секунд
  if (callDurationSeconds !== undefined && callDurationSeconds < 10) {
    return {
      transcript_summary: `Разговор не состоялся: длительность вызова ${callDurationSeconds} сек (менее 10 секунд), диалог между оператором и клиентом отсутствует.`,
      booking_status: 'не применимо',
      formatted_transcript: clean || 'Разговор не состоялся (диалог отсутствует)',
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'не состоялся',
        booking_status: 'не применимо',
        client_issue: 'Звонок менее 10 секунд / диалог отсутствует',
      },
      operator_score: null,
      operator_comment: `Оценка не выставляется: разговор не состоялся (длительность ${callDurationSeconds} сек менее 10 секунд).`,
      recommendations: 'Повторить попытку дозвона клиенту в рабочее время салона «Лик 28».',
    };
  }

  // 2. Пустой транскрипт или заглушка (ожидание STT)
  const isPlaceholderOrEmpty =
    !clean ||
    lower.includes('стенограмма ожидает') ||
    lower.includes('запись разговора и стенограмма отсутствуют') ||
    lower.includes('разговор не состоялся');

  if (isPlaceholderOrEmpty) {
    const durLabel = callDurationSeconds !== undefined ? ` (длительность ${callDurationSeconds} сек.)` : '';
    return {
      transcript_summary: `Разговор не состоялся: аудиозапись${durLabel} не содержит разборчивой речи (зафиксированы только гудки/тишина или сброс линии).`,
      booking_status: 'не применимо',
      formatted_transcript: clean || `Аудиозапись${durLabel} не содержит разборчивой речи.`,
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'не состоялся',
        booking_status: 'не применимо',
        client_issue: 'Отсутствует разборчивая речь в аудиозаписи',
      },
      operator_score: null,
      operator_comment: `Оценка не выставляется: аудиозапись${durLabel} не содержит разборчивого диалога оператора и клиента.`,
      recommendations: 'Проверить качество связи или повторить вызов.',
    };
  }

  // 3. Чистый автоответчик/голосовая почта — ТОЛЬКО если реального диалога нет
  const hasDialogue =
    (lower.includes('клиент:') && (lower.includes('менеджер:') || lower.includes('администратор:'))) ||
    clean.split('\n').filter(l => l.trim().length > 0).length >= 2;

  const isPureAuto =
    !hasDialogue &&
    (lower.includes('оставьте сообщение после сигнала') ||
      lower.includes('вас приветствует автоответчик') ||
      lower.includes('абонент временно недоступен') ||
      lower.includes('голосовая почта') ||
      lower.includes('автоинформатор'));

  if (isPureAuto) {
    return {
      transcript_summary: 'Разговор не состоялся: сработал автоответчик или голосовая почта. Запись не оформлена.',
      booking_status: 'не применимо',
      formatted_transcript: clean,
      key_facts: {
        is_dispute: false,
        dispute_reason: null,
        tone_client: 'нейтральный',
        tone_manager: 'нейтральный',
        call_outcome: 'не состоялся',
        booking_status: 'не применимо',
        client_issue: 'Звонок не состоялся / автоответчик',
      },
      operator_score: null,
      operator_comment: 'Разговор не состоялся: зафиксирован автоответчик (оценка не выставляется).',
      recommendations: 'Повторить звонок клиенту в рабочие часы салона «Лик 28».',
    };
  }

  // 4. Реальный разговор с речью (от 10 секунд и больше)
  const isDispute =
    lower.includes('отмен') || lower.includes('жалоб') || lower.includes('претензи') ||
    lower.includes('недоволен') || lower.includes('издеваетесь');
  const isDeclined =
    lower.includes('не будет в городе') || lower.includes('не смогу') || lower.includes('не получается') ||
    lower.includes('неудобно') || lower.includes('не подходит') || lower.includes('отказ');

  const isBooking =
    !isDeclined &&
    (lower.includes('записали') || lower.includes('записала') || lower.includes('записал') ||
      lower.includes('записываю') || lower.includes('записан') || lower.includes('записана') || lower.includes('записаны') ||
      lower.includes('запишите') || lower.includes('запись оформлена') || lower.includes('запись подтверждена') ||
      lower.includes('до встречи') || lower.includes('ждем вас') || lower.includes('ждём вас') ||
      lower.includes('ждем') || lower.includes('ждём') || lower.includes('жду вас') || lower.includes('будем ждать') ||
      lower.includes('договорились') || lower.includes('согласна') || lower.includes('согласен') ||
      lower.includes('буду к') || lower.includes('буду в') || lower.includes('приду в') || lower.includes('приду к') ||
      lower.includes('подходит время') || lower.includes('подходит этот день') || lower.includes('подтверждаю запись'));

  const outcome = isBooking ? 'запись' : (isDeclined ? 'отказ' : (isDispute ? 'перезвон' : 'консультация'));
  const bookingStatus = isBooking ? 'согласие' : (isDeclined ? 'отказ' : 'консультация');

  const cleanSnippet = clean.replace(/^(клиент:|менеджер:|администратор:)\s*/gim, '').trim().slice(0, 160);
  const durPrefix = callDurationSeconds !== undefined ? `[${callDurationSeconds} сек.] ` : '';

  let summaryText = '';
  if (isBooking) {
    summaryText = `${durPrefix}Клиент обратился в салон «Лик 28». Достигнута договоренность о записи на услуги. Статус: согласие.`;
  } else if (isDeclined) {
    summaryText = `${durPrefix}Клиент обратился в салон «Лик 28», но предложенное время не подошло. Статус: отказ от записи.`;
  } else if (isDispute) {
    summaryText = `${durPrefix}Обращение клиента с вопросом/претензией по обслуживанию. Требуется перезвон.`;
  } else {
    summaryText = `${durPrefix}Короткий диалог / консультация: «${cleanSnippet}»`;
  }

  const score = hasDialogue ? (isDispute ? 7 : 9) : 7;
  const comment = hasDialogue
    ? (isDispute
        ? 'Администратор принял претензию/отмену, соблюдая вежливый тон.'
        : 'Администратор вежливо проконсультировал клиента по регламенту «Лик 28».')
    : 'Краткий обмен репликами. Полноценная оценка регламента не выставляется.';

  return {
    transcript_summary: summaryText,
    booking_status: bookingStatus,
    formatted_transcript: transcript,
    key_facts: {
      is_dispute: isDispute,
      dispute_reason: isDispute ? 'Претензия или отмена записи' : null,
      tone_client: isDispute ? 'негативный' : 'нейтральный',
      tone_manager: 'позитивный',
      call_outcome: outcome,
      booking_status: bookingStatus,
      client_issue: isDispute ? 'Вопрос по обслуживанию' : 'Консультация / обращение в салон',
    },
    operator_score: score,
    operator_comment: comment,
    recommendations: 'Соблюдать стандарты сервиса и вежливого общения салона «Лик 28».',
  };
}

