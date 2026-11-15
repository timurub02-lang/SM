import assert from 'node:assert/strict';
import {journalAuthor,journalIdentity} from '../lib/journal-author.ts';
const employee={id:'operator',name:'Оператор',role:'operator',impersonation:{id:'mode',adminId:'head',adminName:'Руководитель',ownerRole:'department_head'}};
assert.deepEqual(journalAuthor('Исходный автор','operator'),{actor:'Исходный автор',actorId:'operator'});
await Promise.all([journalIdentity.run(employee,async()=>{
 await new Promise(resolve=>setTimeout(resolve,10));
 assert.deepEqual(journalAuthor('Оператор','operator'),{actor:'РК Руководитель от имени оператора Оператор',actorId:'operator',delegatedById:'head'});
 assert.deepEqual(journalAuthor('Система'),{actor:'Система',actorId:undefined},'Background/system events are not attributed to the initiating user');
}),journalIdentity.run({...employee,impersonation:undefined},async()=>{
 await new Promise(resolve=>setTimeout(resolve,20));
 assert.deepEqual(journalAuthor('Оператор','operator'),{actor:'Оператор',actorId:'operator'});
})]);
assert.equal(journalIdentity.getStore(),undefined);
console.log('Journal author: trusted request identity, original actorId and concurrent real operator isolation passed');
