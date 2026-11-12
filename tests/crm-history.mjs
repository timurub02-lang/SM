import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../server/sqlite.ts';
import {redemptionTransferText} from '../lib/redemption-transfer-history.ts';
import {readCrmHistory} from '../lib/crm-history.ts';
const d=openDatabase(':memory:');
try{
 for(const sql of readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8').split('--> statement-breakpoint'))await d.prepare(sql).run();
 await d.prepare('CREATE TABLE incoming_calls(client_id TEXT,closed_at TEXT,shared_queue INTEGER)').run();
 const operator={id:'one',name:'One',login:'one',role:'operator',department:'1'},other={...operator,id:'two',name:'Two',login:'two',department:'2'},head={id:'head',name:'Head',login:'head',role:'department_head',department:'1'},admin={id:'admin',role:'admin'};
 for(const e of [operator,other,head])await d.prepare('INSERT INTO employees(id,data) VALUES(?,?)').bind(e.id,JSON.stringify(e)).run();
 for(const e of [operator,other]){
  const history=Array.from({length:61},(_,i)=>({externalId:e.id+'-'+i,source:'LV',status:'paid',createdAt:'2026-01-01',amount:1,items:[]}));
  await d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind(e.id,e.id,JSON.stringify({id:e.id,owner:e.id,legacyOrderHistory:history})).run();
  await d.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').bind('o-'+e.id,e.id,JSON.stringify({id:'o-'+e.id,clientId:e.id,manager:e.id,status:'draft'})).run();
  for(let i=0;i<61;i++){const event={id:e.id+'-'+String(i).padStart(3,'0'),clientId:e.id,orderId:'o-'+e.id,at:'2026-11-12T00:00:00Z',actor:e.login,actorId:e.id,text:'test'};await d.prepare('INSERT INTO events VALUES(?,?,?,?,?)').bind(event.id,event.clientId,event.orderId,event.at,JSON.stringify(event)).run();}
 }
 const first=await readCrmHistory(d,operator,{clientId:'one',page:0}),next=await readCrmHistory(d,operator,{clientId:'one',page:1});
 assert.equal(first.total,61);assert.equal(first.rows.length,50);assert.equal(next.rows.length,11);assert.equal(new Set([...first.rows,...next.rows].map(r=>r.id)).size,61);
 assert.equal((await readCrmHistory(d,operator,{clientId:'two',page:0})).total,0);
 assert.equal((await readCrmHistory(d,head,{clientId:'one',page:0})).total,61);
 assert.equal((await readCrmHistory(d,head,{clientId:'two',page:0})).total,0);
 assert.equal((await readCrmHistory(d,admin,{employeeId:'two',page:0})).total,61);
 await assert.rejects(readCrmHistory(d,operator,{employeeId:'two',page:0}));
 assert.equal((await readCrmHistory(d,operator,{clientId:'one',page:1,legacy:true})).rows.length,11);
 await assert.rejects(readCrmHistory(d,operator,{clientId:'two',page:0,legacy:true}));
 await d.prepare("INSERT INTO incoming_calls VALUES('two',NULL,1)").run();assert.equal((await readCrmHistory(d,head,{clientId:'two',orderId:'o-two',page:0})).total,61,'shared incoming history remains visible');
 await d.prepare("UPDATE events SET data=json_set(data,'$.actorId','') WHERE client_id='one'").run();assert.equal((await readCrmHistory(d,operator,{employeeId:'one',page:0})).total,61,'empty legacy actor IDs retain login matching');
 await d.prepare('CREATE TABLE redemption_history(id INTEGER PRIMARY KEY,order_id TEXT,at TEXT,data TEXT)').run();
 const transfer={changeKind:'return_operator',updatedAt:'2026-11-13T10:00:00.000Z',changedBy:'Выкуп',operatorReturn:{reason:'Отработать отказ',comment:'Нет денег',at:'2026-11-13T10:00:00.000Z',deadline:'2026-11-15T10:00:00.000Z'}};
 const timeout={...transfer,changeKind:'operator_return_timeout',changedBy:'Система',updatedAt:'2026-11-15T10:00:01.000Z',operatorReturn:{...transfer.operatorReturn,resolvedAt:'2026-11-15T10:00:01.000Z'}};
 for(const [id,order,v] of [[1,'o-one',transfer],[2,'o-one',timeout],[3,'o-two',transfer]])await d.prepare('INSERT INTO redemption_history VALUES(?,?,?,?)').bind(id,order,v.updatedAt,JSON.stringify(v)).run();
 const history=await readCrmHistory(d,operator,{clientId:'one',orderId:'o-one',page:0});assert.equal(history.total,63);assert.match(history.rows[0].text,/Срок обработки истёк/);assert.match(history.rows[1].text,/Передан оператору в работу/);assert.match(history.rows[1].text,/15.11.2026, 13:00:00 МСК/);assert.equal(history.rows[1].actor,'Выкуп');assert.equal(history.rows[1]._redemption,undefined);
 assert.equal((await readCrmHistory(d,other,{clientId:'one',orderId:'o-one',page:0})).total,0);
 assert.equal((await readCrmHistory(d,head,{clientId:'one',orderId:'o-one',page:0})).total,63);
 const more=await readCrmHistory(d,operator,{clientId:'one',orderId:'o-one',page:1});assert.equal(new Set([...history.rows,...more.rows].map(r=>r.id)).size,63);
 assert.match(redemptionTransferText({...transfer,changeKind:'operator_nd'}),/недозвон/);
 assert.match(redemptionTransferText({...transfer,changeKind:'action',result:'date',resultDate:'2026-11-14',operatorReturn:{...transfer.operatorReturn,resolvedAt:transfer.updatedAt}}),/Обработка возвращённого заказа завершена/);
 assert.equal(redemptionTransferText({...transfer,changeKind:'comment',updatedAt:'2026-11-13T11:00:00Z'}),'');
 console.log('History: pagination, tied timestamps, operator/head scopes, actor journals and legacy access passed');
}finally{d.close();}
