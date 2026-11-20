import assert from 'node:assert/strict';
import {redemptionRowAuthor,compareRedemptionPeople} from '../lib/redemption.ts';
const day='2026-11-18',rows=[{id:'z',operator:'Яна',login:'A_User',author:'Яна',lastDay:day},{id:'old',operator:'Борис',login:'B_User',author:'Анна',lastDay:'2026-11-17'},{id:'a',operator:'Анна',login:'Z_User',author:'Анна',lastDay:day},{id:'empty',operator:'Галина',login:'G_User'}];
const ids=(column,ascending,tab='work')=>[...rows].sort((a,b)=>compareRedemptionPeople(a,b,column,ascending,tab,day)).map(r=>r.id);
for(const tab of ['work','all','archive','operator','confirm','returns']){
 assert.deepEqual(ids('operator',true,tab),['z','old','empty','a']);
 assert.deepEqual(ids('operator',false,tab),['a','empty','old','z']);
}
assert.deepEqual(ids('author',true),['old','empty','a','z']);
assert.deepEqual(ids('author',false),['z','a','old','empty']);
assert.deepEqual(ids('author',true,'archive'),['empty','old','a','z']);
assert.equal(redemptionRowAuthor(rows[1],'work',day),'');
assert.equal(redemptionRowAuthor(rows[1],'all',day),'Анна');
const held={id:'held',operator:'А',author:'А',result:'returned'};
for(const ascending of [true,false])assert.deepEqual([held,rows[0]].sort((a,b)=>compareRedemptionPeople(a,b,'author',ascending,'returns',day)).map(r=>r.id),['z','held']);
assert.ok(compareRedemptionPeople({login:'10'},{login:'2'},'operator',true,'work',day)>0);
console.log('Redemption sort: both directions, blank visible author, archive, logins, stable ties and grey priority passed');
