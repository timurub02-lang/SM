import assert from 'node:assert/strict';
import {journalAction} from '../lib/journal-action.ts';
assert.equal(journalAction('Подтверждение → Проверка · позвонить +79123456789','operator'),'Подтверждение → Проверка');
assert.equal(journalAction('Комментарий: +79123456789','department_head'),'Добавлен комментарий');
assert.equal(journalAction('Перезвон: клиент просил','operator'),'Назначен перезвон');
assert.equal(journalAction('Недозвон: нет ответа','operator'),'Зафиксирован недозвон');
assert.equal(journalAction('Изменён способ доставки','operator'),'Изменён способ доставки');
assert.equal(journalAction('Комментарий: текст','admin'),'Комментарий: текст');
console.log('Journal action checks passed');
