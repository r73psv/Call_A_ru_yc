/**
 * Чистые утилиты нормализации и диаризации стенограмм (работают как на сервере, так и в браузере).
 */

/**
 * Вычисляет коэффициент сходства двух строк (на основе биграмм / коэффициента Соренсена-Дайса)
 */
export function calculateTextSimilarity(s1: string, s2: string): number {
  const str1 = (s1 || '').toLowerCase().replace(/[^a-zа-яё0-9\s]/gi, '').trim();
  const str2 = (s2 || '').toLowerCase().replace(/[^a-zа-яё0-9\s]/gi, '').trim();

  if (str1 === str2) return 1.0;
  if (!str1 || !str2) return 0.0;
  if (str1.length < 2 || str2.length < 2) return 0.0;

  const getBigrams = (str: string) => {
    const bigrams = new Map<string, number>();
    for (let i = 0; i < str.length - 1; i++) {
      const bg = str.substring(i, i + 2);
      bigrams.set(bg, (bigrams.get(bg) || 0) + 1);
    }
    return bigrams;
  };

  const bg1 = getBigrams(str1);
  const bg2 = getBigrams(str2);

  let intersection = 0;
  for (const [bg, count1] of bg1.entries()) {
    const count2 = bg2.get(bg) || 0;
    intersection += Math.min(count1, count2);
  }

  const total = (str1.length - 1) + (str2.length - 1);
  return (2.0 * intersection) / total;
}

/**
 * Разделяет склеенные в одном предложении реплики разных говорящих
 * (например, прощание администратора и ответ клиента «Угу взаимно...»)
 */
export function splitConjoinedLines(lines: string[]): { text: string; forcedSpeaker?: 'Менеджер' | 'Клиент' }[] {
  const result: { text: string; forcedSpeaker?: 'Менеджер' | 'Клиент' }[] = [];

  for (const line of lines) {
    const raw = line.replace(/^(Менеджер:|Клиент:|Администратор:|Оператор:|Неизвестный:)\s*/i, '').trim();
    if (!raw) continue;

    // Склейка в финале: Прощание администратора + ответ клиента
    const fareMatch = raw.match(
      /^(.*?(?:записать|до свидания|всего доброго|рады видеть|до встречи))\s+(Угу\s+(?:взаимно|все|да).*|взаимно.*|и вам.*|спасибо.*до свидания.*)$/i
    );
    if (fareMatch && fareMatch[1].trim().length > 3 && fareMatch[2].trim().length > 3) {
      result.push({ text: fareMatch[1].trim(), forcedSpeaker: 'Менеджер' });
      result.push({ text: fareMatch[2].trim(), forcedSpeaker: 'Клиент' });
      continue;
    }

    // Склейка в начале: Приветствие администратора + ответ/просьба клиента
    const greetMatch = raw.match(
      /^(.*?(?:слушаю вас|чем могу помочь)[.!]?)\s+([Зз]дравствуйте.*|[Дд]обрый.*|[Аа]\s+подскажите.*|[Яя]\s+бы хотел.*)/i
    );
    if (greetMatch && greetMatch[1].trim().length > 3 && greetMatch[2].trim().length > 3) {
      result.push({ text: greetMatch[1].trim(), forcedSpeaker: 'Менеджер' });
      result.push({ text: greetMatch[2].trim(), forcedSpeaker: 'Клиент' });
      continue;
    }

    // Склейка вопроса о номере: Вопрос администратора + номер клиента
    const phoneMatch = raw.match(
      /^(.*?(?:подскажите ваш номер|ваш номер|номер телефона)[?.:!]?)\s+([0-9\s-+]{3,}.*)/i
    );
    if (phoneMatch && phoneMatch[1].trim().length > 3 && phoneMatch[2].trim().length > 3) {
      result.push({ text: phoneMatch[1].trim(), forcedSpeaker: 'Менеджер' });
      result.push({ text: phoneMatch[2].trim(), forcedSpeaker: 'Клиент' });
      continue;
    }

    result.push({ text: raw });
  }

  return result;
}

/**
 * Интеллектуально нормализует и распределяет реплики по ролям Менеджер / Клиент,
 * исправляя ошибочные метки и склеенные предложения.
 */
export function refineTranscriptRoles(raw: string): string {
  if (!raw || typeof raw !== 'string') return raw;

  const rawLines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  if (rawLines.length === 0) return '';

  const splitItems = splitConjoinedLines(rawLines);
  const result: string[] = [];
  let prevSpeaker: 'Менеджер' | 'Клиент' = 'Клиент';

  for (let i = 0; i < splitItems.length; i++) {
    const item = splitItems[i];
    const phrase = item.text;
    const lower = phrase.toLowerCase();

    if (item.forcedSpeaker) {
      result.push(`${item.forcedSpeaker}: ${phrase}`);
      prevSpeaker = item.forcedSpeaker;
      continue;
    }

    // Маркеры администратора / менеджера салона «Лик 28»
    const isManager =
      (i === 0 && (lower.includes('добрый') || lower.includes('слушаю') || lower.includes('салон') || lower.includes('здравствуйте'))) ||
      lower.includes('менеджер') ||
      lower.includes('администратор') ||
      lower.includes('салон красоты') ||
      lower.includes('лик 28') ||
      lower.includes('слушаю вас') ||
      lower.includes('чем могу помочь') ||
      lower.includes('подскажите ваш номер') ||
      lower.includes('подскажите номер') ||
      lower.includes('минуточку, сейчас') ||
      lower.includes('минуточку') ||
      lower.includes('сейчас посмотрим') ||
      lower.includes('1 минуту') ||
      lower.includes('одну минуту') ||
      lower.includes('подобрать вам') ||
      lower.includes('подберу вам') ||
      lower.includes('подберу мастер') ||
      lower.includes('топ эксперт') ||
      lower.includes('эксперт категории') ||
      lower.includes('хотели бы попробовать') ||
      lower.includes('к другому хотели бы') ||
      lower.includes('могу предложить') ||
      lower.includes('предложу запись') ||
      lower.includes('у мастера нерабочий день') ||
      lower.includes('у мастера выходной') ||
      lower.includes('мастер не работает') ||
      lower.includes('подряд подряд записи') ||
      lower.includes('у надежды по 30 минут') ||
      lower.includes('будем рады в следующий раз') ||
      lower.includes('будем рады вас видеть') ||
      lower.includes('выполняем оформление') ||
      lower.includes('записи немножко с запасом') ||
      lower.includes('единственное время свободное') ||
      lower.includes('хорошего дня вам, кристина') ||
      lower.includes('хорошего дня вам');

    // Маркеры клиента
    const isClient =
      lower.includes('а подскажите') ||
      lower.includes('у кого я стригла') ||
      lower.includes('стригла челку') ||
      lower.includes('хотела бы') ||
      lower.includes('хочу записаться') ||
      lower.includes('хочется записаться') ||
      lower.includes('чикнула прям 5 минут') ||
      lower.includes('чикнула') ||
      lower.includes('мне нельзя вот') ||
      lower.includes('впихнуть пораньше') ||
      lower.includes('не будет в городе') ||
      lower.includes('в москве') ||
      /^\+?[0-9\s-]{3,}$/.test(phrase) || // Цифры номера телефона
      lower === 'верно.' ||
      lower === 'верно' ||
      lower === 'да, верно' ||
      lower.includes('угу взаимно') ||
      lower.includes('взаимно все хорошего дня');

    let currentSpeaker: 'Менеджер' | 'Клиент';
    if (isManager && !isClient) {
      currentSpeaker = 'Менеджер';
    } else if (isClient && !isManager) {
      currentSpeaker = 'Клиент';
    } else {
      currentSpeaker = prevSpeaker === 'Менеджер' ? 'Клиент' : 'Менеджер';
    }

    result.push(`${currentSpeaker}: ${phrase}`);
    prevSpeaker = currentSpeaker;
  }

  return result.join('\n');
}

/**
 * Исправляет стенограммы с дублированными репликами и нормализует разделение ролей
 */
export function fixDuplicatedTranscript(raw: string): string {
  if (!raw || typeof raw !== 'string') return raw;
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return raw;

  // Извлекаем чистые фразы и удаляем подряд идущие дубликаты
  const cleanPhrases: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const textOnly = lines[i].replace(/^(Менеджер:|Клиент:|Администратор:|Оператор:|Неизвестный:)\s*/i, '').trim();
    if (!textOnly) continue;

    if (cleanPhrases.length > 0) {
      const prev = cleanPhrases[cleanPhrases.length - 1];
      if (calculateTextSimilarity(textOnly, prev) > 0.65) {
        if (textOnly.length > prev.length) {
          cleanPhrases[cleanPhrases.length - 1] = textOnly;
        }
        continue;
      }
    }
    cleanPhrases.push(textOnly);
  }

  // Применяем ролевую диаризацию и сплит склеенных предложений
  return refineTranscriptRoles(cleanPhrases.join('\n'));
}
