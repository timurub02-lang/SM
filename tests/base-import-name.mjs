import assert from 'node:assert/strict';
import {nameBase} from '../lib/name-base.ts';
import {planImport} from '../lib/base-import.ts';
for(const [name,expected] of [['Иванов Иван Иванович','M'],['Иванова Анна Ивановна','J'],['Семёнов Пётр Ильич','M'],['Иванов И. И.',null],['Иванова Саша Ивановна','J'],['Иванова Анна Иванович',null],['Иванова',null],['Алексей и Анна',null],['Иванова Неизвестная Ивановна',null],['Павел Сергеевич Иванов','M'],['Анна Ивановна Петрова.','J'],['Иванов Никита','M'],['Кузьма','M'],['Нинель','J'],['Любовь','J'],['- Расима -','J'],['Иванов Марсель Петрович','M'],['Иванова Редкоеимя Петровна','J'],['Иванов Павел Анна',null],['Иванов Иванович',null],['Иванов 123 Иванович',null],['Саша',null],['Анна/Павел',null],['',null]])assert.equal(nameBase(name),expected,name);
const targets={M:'Т1',J:'Ж1'}, row=(phone,name='Иванова Анна Ивановна')=>({row:1,phone,name});
for(const name of ['Денисевич Анна Ивановна','Анна Ивановна Денисевич','Ивановна Анна Петрова'])assert.equal(nameBase(name),'J',name);
assert.equal(nameBase('Петров- Иван Сергеевич'),'M');
let p=planImport([row('79990000001'),row('79990000002','Иванов Иван Иванович'),row('79990000003','Саша')],[],'M','Т1',{},targets);
assert.deepEqual(p.added.map(x=>[x.destination,x.target]),[['J','Ж1'],['M','Т1']]);assert.equal(p.review.length,1);
p=planImport([row('79990000003','Саша')],[],'M','Т1',{'new:79990000003':'J'},targets);assert.equal(p.added[0].destination,'J');assert.equal(p.review.length,0);
for(const sheet of ['К','П','ЧС','ПВ','Т1','П1']){
 const c={id:'c',phone:'79990000001',linkedPhones:['79990000002'],baseType:'M',sheet,owner:'',version:1};
 p=planImport([row('79990000002')],[c],'J','Ж1',{},targets);assert.equal(p.added.length,0);assert.equal(p.review.length,0);assert.equal(p.moved.length,0);assert.equal(p.skipped,1);
 p=planImport([row('79990000002')],[c],'J','Ж1',{c:'J'});assert.equal(p.moved.length,0);assert.equal(p.conflicts.length,0);assert.equal(p.skipped,1);
 c.owner='op';p=planImport([row(c.phone)],[c],'J','Ж1',{},targets);assert.equal(p.moved.length,0);
}
p=planImport([{...row('79990000001'),linkedPhones:['79990000002']},row('79990000002')],[],'M','Т1',{},targets);assert.equal(p.added.length,1);assert.equal(p.duplicates,1);
p=planImport([{...row('79990000001'),linkedPhones:['79990000002']}],[{id:'a',phone:'79990000001',version:1},{id:'b',phone:'79990000002',version:1}],'M','Т1',{},targets);assert.equal(p.added.length,0);assert.equal(p.invalid.length,1);
console.log('Name routing, review, duplicate phones and protected existing clients passed');
