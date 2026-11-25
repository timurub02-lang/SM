import assert from 'node:assert/strict';
import {readReplacementCsv} from '../lib/replacement-csv.ts';

const read = text => readReplacementCsv(new TextEncoder().encode(text).buffer);
const header = 'Адрес;Номер телефона;Идентификационный номер';
const rows = '\r\n"Город; дом ""7""\nкорпус";9000000001;9000000003\r\n1;;2\r\n2;+7 (900) 000-00-01;3\r\n3;89000000002;';
assert.deepEqual(read('\uFEFF'+header+rows), ['79000000001','79000000002']);
const cp1251 = Uint8Array.from(header+rows, c=>c.charCodeAt(0)>=0x410 ? c.charCodeAt(0)-0x410+0xc0 : c.charCodeAt(0));
assert.deepEqual(readReplacementCsv(cp1251.buffer), ['79000000001','79000000002']);
assert.throws(()=>read('Идентификатор;Телефон\n123;9000000000'),/столбец/);
assert.throws(()=>read('Номер телефона;НОМЕР ТЕЛЕФОНА\n1;2'),/столбец/);
assert.throws(()=>read(header+'\n1;9000000000;1\n2;ID9000000001;2'),/записи 3/);
assert.throws(()=>read(header+'\n1;9000000000'),/столбцов/);
assert.throws(()=>read(header+'\n"1;9000000000;2'),/формат/);
assert.throws(()=>read(header+'\n1;;2'),/нет номеров/);
