import {normalizePhone} from './crm.ts';

export function readReplacementCsv(bytes: ArrayBuffer) {
  let text: string;
  try {
    text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1251').decode(bytes);
  }
  // The supplier uses semicolons. Quoted fields may contain delimiters, newlines and doubled quotes.
  const field = /(?:"((?:[^"]|"")*)"|([^;"\r\n]*))(;|\r\n?|\n|$)/gy;
  const numbers = new Set<string>();
  let phoneColumn = -1, width = 0, record = 1;
  let row: string[] = [];
  while (field.lastIndex < text.length) {
    const match = field.exec(text);
    if (!match) throw Error(`Неверный формат CSV в записи ${record}`);
    row.push((match[1]?.replace(/""/g, '"') ?? match[2]).trim());
    if (match[3] === ';') {
      if (field.lastIndex < text.length) continue;
      row.push('');
    }
    if (row.some(Boolean)) {
      if (phoneColumn < 0) {
        const headers = row.map(value => value.toLowerCase());
        phoneColumn = headers.indexOf('номер телефона');
        if (phoneColumn < 0 || phoneColumn !== headers.lastIndexOf('номер телефона')) {
          throw Error('В CSV нужен один столбец «Номер телефона» и разделитель «;»');
        }
        width = row.length;
      } else {
        if (row.length !== width) throw Error(`Неверное число столбцов в записи ${record}`);
        const value = row[phoneColumn];
        if (value) {
          const phone = /^[+\d()\s-]+$/.test(value) && normalizePhone(value);
          if (!phone) throw Error(`Некорректный номер телефона в записи ${record}`);
          numbers.add(phone.slice(1));
          if (numbers.size > 10000) throw Error('За раз можно загрузить до 10 000 номеров');
        }
      }
    }
    row = [];
    record++;
  }
  if (!numbers.size) throw Error('В файле нет номеров для загрузки');
  return [...numbers];
}
