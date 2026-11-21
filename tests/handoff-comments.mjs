import assert from 'node:assert/strict';
import {previousHandoffComments,handoffEntries,handoffComment} from '../lib/handoff-comments.ts';
const messages=[
 'Подтверждено руководителем · РК · Возврат оператору → Подтверждение · Заказ согласован',
 'Подтверждение → Возврат оператору · Уточнить данные / связаться с клиентом · 1',
 'Возврат оператору → Подтверждение · Согласовано 9500\nВторую упаковку убрать',
 'Возврат оператору → Подтверждение',
 'Комментарий: посторонняя заметка',
].map((text,i)=>({id:String(i),actor:'Автор '+i,at:'17:0'+i,text:text+'\nСтатус: А → Б'}));
const result=previousHandoffComments(handoffEntries(messages),'Заказ согласован');
assert.deepEqual(result.map(r=>[r.id,r.actor,r.text]),[['1','Автор 1','1'],['2','Автор 2','Согласовано 9500\nВторую упаковку убрать']]);
assert.equal(handoffComment('Доп. подтверждение → Возврат оператору · Отработать отказ клиента · Уточнить адрес'),'Уточнить адрес');
assert.equal(handoffComment('Возврат оператору → Подтверждение · Комментарий логиста: инструкция'),'');
