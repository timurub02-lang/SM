import {seedSkDispatch} from './fixtures/sk-dispatch.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../server/sqlite.ts';
import {operatorPendingSkOrders,acceptSkOrder,initSkOrders,skMayDecide,skSender} from '../lib/sk-order-import.ts';
import {skClientPhone,syncSkOrders} from '../lib/sk-order-sync.ts';
import {syncActivity} from '../lib/activity-sync.ts';
import {mayCallEndpoint} from '../lib/permissions.ts';
assert.equal(skClientPhone({direction:'in',phone:'79990000999',source:'79990000001'},{lead_phones:['+7 (999) 000-00-01','+79990000002']}),'+79990000001');
assert.equal(skClientPhone({direction:'in',phone:'79990000999'},{lead_phones:['+79990000001']}),'+79990000001');
assert.equal(skClientPhone({direction:'out',phone:'79990000002'},{lead_phones:['+79990000001','+79990000002']}),'+79990000002');
assert.equal(skClientPhone({direction:'in',phone:'79990000999'},{phones:'+79990000001; +79990000002'}),'');
assert.equal(skClientPhone({direction:'in',phone:'79990000999'},{}),'');
const d=openDatabase(':memory:');for(const sql of readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8').split('--> statement-breakpoint'))await d.prepare(sql).run();
const sender={id:'op',name:'Operator',login:'op',skLogin:'СКП_Оператор',role:'operator',department:'1',version:1},other={...sender,id:'other',login:'other',skLogin:'other@test.invalid',department:'2'},head={...sender,id:'head',skLogin:'',role:'department_head',department:'2'},admin={...sender,id:'admin',skLogin:'',role:'admin'};
for(const e of [sender,other,head,admin])await d.prepare('INSERT INTO employees(id,data) VALUES(?,?)').bind(e.id,JSON.stringify(e)).run();
assert.equal(skSender([{...sender,skLogin:'СКП_Ирина Соломатина'}],'user@test.invalid','СКП_Ирина Соломатина',true)?.id,'op');
assert.equal(skSender([{...sender,skLogin:'СКП_Ирина Соломатина'}],'user@test.invalid','СКП_Ирина Соломатина',false),undefined);
assert.equal(skSender([sender,{...other,skLogin:sender.skLogin}],sender.skLogin),undefined);
const input={callId:'1',projectId:'12345',leadId:'10',email:'op@test.invalid',userName:'СКП_Оператор',userNameUnique:true,name:'Test Client',phone:'89990000001',city:'',address:'New address',comment:'SK comment'};
const r=await acceptSkOrder(d,input);assert.equal(r.state,'imported');assert.equal(r.orderId,'SK-1');
const client=JSON.parse((await d.prepare('SELECT data FROM clients').first()).data);assert.equal(client.owner,'op');assert.equal(client.sheet,'К');assert.equal(client.address,'New address');assert.equal(client.phone,'+79990000001');
const o=JSON.parse((await d.prepare('SELECT data FROM orders').first()).data);assert.equal(o.skLeadId,input.leadId);assert.equal(o.status,'draft');assert.equal(o.manager,'op');assert.equal(o.items.length,0);
assert.equal((await acceptSkOrder(d,input)).orderId,r.orderId);assert.equal((await d.prepare('SELECT count(*) n FROM orders').first()).n,1);
// Separate calls, normalized phone and simultaneous attempts must be silent terminal duplicates.
const beforeDuplicate=(await d.prepare('SELECT data,version FROM clients').first());
const duplicates=await Promise.all(['101','102'].map(callId=>acceptSkOrder(d,{...input,callId,phone:'+79990000001'})));
assert.deepEqual(duplicates.map(r=>r.state),['duplicate','duplicate']);
assert.deepEqual(await d.prepare('SELECT data,version FROM clients').first(),beforeDuplicate);
assert.equal((await d.prepare("SELECT count(*) n FROM sk_order_transfers WHERE state='pending'").first()).n,0);
assert.equal((await acceptSkOrder(d,{...input,callId:'101'},undefined,'2030-01-01T00:00:00Z')).state,'duplicate','blocked call cannot replay after cooldown');
const t='2030-01-01T10:00:00Z';
const noProject={...input,callId:'201',projectId:null,phone:'+79990000201'};
assert.equal((await acceptSkOrder(d,noProject,undefined,t)).state,'pending');
assert.equal(await d.prepare("SELECT id FROM clients WHERE phone='+79990000201'").first(),null);
assert.equal((await acceptSkOrder(d,{...noProject,callId:'202'},undefined,'2030-01-01T10:09:59Z')).state,'duplicate');
assert.equal((await d.prepare("SELECT reason FROM sk_order_transfers WHERE id='201'").first()).reason,'Создан не из Проекта');
const noProjectApproved=await acceptSkOrder(d,noProject,admin,t);
assert.equal(noProjectApproved.state,'imported');
assert.equal(JSON.parse((await d.prepare('SELECT data FROM orders WHERE id=?').bind(noProjectApproved.orderId).first()).data).skWithoutProject,true);
assert.equal((await acceptSkOrder(d,{...noProject,callId:'203'},undefined,'2030-01-01T10:10:00Z')).state,'pending','ten minutes expire without extending on blocked attempts');
await d.prepare("DELETE FROM orders WHERE client_id='C-SK-201'").run();
await d.prepare("DELETE FROM clients WHERE id='C-SK-201'").run();
await d.prepare("DELETE FROM sk_order_transfers WHERE id IN ('201','202','203')").run();
await d.prepare('UPDATE clients SET data=json_set(data,\'$.owner\',\'other\'),version=version+1').run();
const concurrent=await Promise.all(['301','302'].map(callId=>acceptSkOrder(d,{...input,callId,phone:'+79990000301'})));
assert.deepEqual(concurrent.map(r=>r.state).sort(),['duplicate','imported']);
assert.equal((await d.prepare("SELECT count(*) n FROM clients WHERE phone='+79990000301'").first()).n,1);
const concurrentClient=(await d.prepare("SELECT id FROM clients WHERE phone='+79990000301'").first()).id;
assert.equal((await d.prepare('SELECT count(*) n FROM orders WHERE client_id=?').bind(concurrentClient).first()).n,1);
await d.prepare('DELETE FROM orders WHERE client_id=?').bind(concurrentClient).run();
await d.prepare('DELETE FROM clients WHERE id=?').bind(concurrentClient).run();
await d.prepare('DELETE FROM sk_order_cooldowns').run();
const conflict={...input,callId:'2',address:'Different address'};assert.equal((await acceptSkOrder(d,conflict)).state,'pending');assert.equal((await d.prepare('SELECT count(*) n FROM orders').first()).n,1);
assert.match((await d.prepare("SELECT reason FROM sk_order_transfers WHERE id='2'").first()).reason,/other/);
await assert.rejects(acceptSkOrder(d,conflict,sender),/Решение/);assert.equal(skMayDecide({...head,department:'1'},sender,other),false);
await assert.rejects(acceptSkOrder(d,conflict,head),/Решение/);assert.equal((await acceptSkOrder(d,conflict,admin)).state,'imported');const approved=JSON.parse((await d.prepare("SELECT data FROM orders WHERE id=(SELECT order_id FROM sk_order_transfers WHERE id='2')").first()).data);assert.equal(approved.address,'New address');assert.match(approved.comment,/Адрес из Скорозвона для сверки: Different address/);
const unknown={...input,callId:'3',phone:'79990000003',email:'missing@test.invalid',userName:'Missing'};assert.equal((await acceptSkOrder(d,unknown)).state,'pending');assert.equal((await acceptSkOrder(d,unknown,admin)).state,'pending');
await d.prepare("UPDATE sk_order_transfers SET state='rejected' WHERE id='3'").run();assert.equal((await acceptSkOrder(d,unknown)).state,'rejected');
await assert.rejects(acceptSkOrder(d,{...input,callId:'4',phone:'123'}),/Некорректный/);
for(const role of ['courier','purchasing','logistic','chief_logistic','redemption','department_head'])for(const method of ['GET','POST']){assert.equal(mayCallEndpoint({...sender,role},new URL('https://crm/api/sk-orders'),method,{}),role==='department_head'&&method==='GET');assert.equal(skMayDecide({...sender,role},sender,other),false);}
for(const method of ['GET','POST'])assert.equal(mayCallEndpoint(admin,new URL('https://crm/api/sk-orders'),method,{}),true);
assert.equal(mayCallEndpoint(sender,new URL('https://crm/api/sk-orders'),'GET',{}),true);
assert.equal(mayCallEndpoint(sender,new URL('https://crm/api/sk-orders'),'POST',{}),false);
assert.equal(mayCallEndpoint(head,new URL('https://crm/api/sk-orders'),'POST',{}),false);
await seedSkDispatch(d,[['C-SK-5','+79990000005'],['C-SK-9','+79990000009']]);
const now=Date.parse('2026-10-21T10:00:00Z');
for(const [id,data] of Object.entries({'skorozvon':{login:'x',apiKey:'x',clientId:'x',clientSecret:'x'},'sk-order-import':{enabled:true,enabledAt:'2026-10-21T09:00:00Z',resultIds:[123]}}))await d.prepare('INSERT INTO settings VALUES(?,?)').bind(id,JSON.stringify(data)).run();
const request=async(url,opts)=>{const p=new URL(url).pathname;let value;
if(p==='/oauth/token')value={access_token:'test'};
else if(p==='/api/v2/users')value={data:[{id:7,email:'op@test.invalid',name:'СКП_Оператор'}]};
else if(p==='/api/reports/calls_total.json'){const b=JSON.parse(opts.body);assert.deepEqual(b.filter.results_ids,[123]);assert.equal(b.start_time,Date.parse('2026-10-21T09:00:00Z')/1000);value={data:[{id:5,scenario_result:{id:123},comment:'call'}],total_pages:1};}
else if(p==='/api/v2/calls/5')value={id:5,result_id:123,call_project_id:12345,ended_at:'2026-10-21 09:10:00',user_id:7,lead_id:11,direction:'in',phone:'79990000999',source:'79990000005'};
else if(p==='/api/v2/leads/11')value={id:11,name:'New',address:'Address',city:'City',lead_phones:['+79990000005']};
else throw Error(p);return Response.json(value);};
assert.equal((await syncSkOrders(d,request,now,async()=>{})).imported,1);
assert.equal(JSON.parse((await d.prepare("SELECT data FROM clients WHERE id='C-SK-5'").first()).data).phone,'+79990000005');
assert.equal(await d.prepare("SELECT id FROM clients WHERE phone='+79990000999'").first(),null);
assert.equal((await syncSkOrders(d,request,now,async()=>{})).imported,0);
const phoneReviewRequest=async(url,opts)=>{
 const p=new URL(url).pathname;
 if(p==='/api/reports/calls_total.json')return Response.json({data:[8,9].map(id=>({id,scenario_result:{id:123}})),total_pages:1});
 if(['/api/v2/calls/8','/api/v2/calls/9'].includes(p)){const id=Number(p.split('/').at(-1));return Response.json({id,result_id:123,call_project_id:12345,ended_at:'2026-10-21 09:10:00',user_id:7,lead_id:id,direction:'in',phone:'79990000999',source:'79990000009'});}
 if(p==='/api/v2/leads/8')return Response.json({id:8,name:'Ambiguous',lead_phones:['+79990000081','+79990000082']});
 if(p==='/api/v2/leads/9')return Response.json({id:9,name:'Verified',phones:'+79990000009'});
 return request(url,opts);
};
assert.deepEqual(await syncSkOrders(d,phoneReviewRequest,now,async()=>{}),{imported:1,pending:1});
assert.equal(await d.prepare("SELECT id FROM orders WHERE id=(SELECT order_id FROM sk_order_transfers WHERE id='8')").first(),null);
assert.ok(await d.prepare("SELECT id FROM orders WHERE id=(SELECT order_id FROM sk_order_transfers WHERE id='9')").first());
const phoneReview=JSON.parse((await d.prepare("SELECT data FROM settings WHERE id='sk-order-health'").first()).data);
assert.equal(phoneReview.ok,false);assert.equal(phoneReview.review[0].callId,'8');
await syncSkOrders(d,request,now,async()=>{});
assert.equal(JSON.parse((await d.prepare("SELECT data FROM settings WHERE id='sk-order-health'").first()).data).review[0].callId,'8','unresolved phone review must not disappear from later polls');

const count=(await d.prepare('SELECT count(*) n FROM orders').first()).n;
await assert.rejects(syncSkOrders(d,async()=>new Response('',{status:503}),now,async()=>{}));assert.equal((await d.prepare('SELECT count(*) n FROM orders').first()).n,count);
await assert.rejects(syncSkOrders(d,async(url,opts)=>new URL(url).pathname==='/oauth/token'?request(url,opts):new Response('limited',{status:429,headers:{'Retry-After':'120'}}),now,async()=>{}));
const limited=JSON.parse((await d.prepare("SELECT data FROM settings WHERE id='sk-order-health'").first()).data);
assert.ok(Date.parse(limited.retryAt)>=now+120000);assert.equal(limited.lastSuccessAt,new Date(now).toISOString());
const noRequest=async()=>assert.fail('Shared provider cooldown must precede all requests');
assert.equal((await syncSkOrders(d,noRequest,now+60000,async()=>{})).deferred,true);
assert.equal((await syncActivity(d,noRequest,now+60000,async()=>{})).deferred,true);
await d.prepare("INSERT INTO settings(id,data) VALUES('activity-health',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify({retryAt:new Date(now+300000).toISOString()})).run();
assert.equal((await syncSkOrders(d,noRequest,now+180000,async()=>{})).deferred,true);
// Production access is stored outside employees.data.
await d.prepare('CREATE TABLE auth_accounts(employee_id TEXT PRIMARY KEY,enabled INTEGER)').run();
await d.prepare('INSERT INTO auth_accounts VALUES(?,0)').bind(sender.id).run();
const disabled={...input,callId:'6',phone:'79990000006'};
assert.equal((await acceptSkOrder(d,disabled)).state,'pending');
assert.equal(await d.prepare("SELECT id FROM orders WHERE id=(SELECT order_id FROM sk_order_transfers WHERE id='6')").first(),null);
await d.prepare('UPDATE auth_accounts SET enabled=1 WHERE employee_id=?').bind(sender.id).run();
assert.equal((await acceptSkOrder(d,disabled)).state,'imported','An explicitly re-enabled operator can receive the pending order');
let raced=false;
const raceDb={...d,async batch(statements){if(!raced&&statements.some(s=>s.sql.startsWith('INSERT INTO orders'))){raced=true;await d.prepare('UPDATE auth_accounts SET enabled=0 WHERE employee_id=?').bind(sender.id).run();}return d.batch(statements);}};
await assert.rejects(acceptSkOrder(raceDb,{...input,callId:'7',phone:'79990000007'}),/сотрудник изменился/);
assert.equal(raced,true);assert.equal(await d.prepare("SELECT id FROM orders WHERE id=(SELECT order_id FROM sk_order_transfers WHERE id='7')").first(),null);assert.equal(await d.prepare("SELECT id FROM clients WHERE id='C-SK-7'").first(),null);
// Pending operator rows never expose another sender, client link, phone, owner or decisions.
await initSkOrders(d);
await d.prepare('DELETE FROM sk_order_transfers').run();
for(const [id,state,extra] of [['901','pending',{}],['902','pending',{userName:other.skLogin}],['903','imported',{}],['904','rejected',{}],['905','duplicate',{}],['906','pending',{userNameUnique:false}]]){
 await d.prepare('INSERT INTO sk_order_transfers(id,data,state,created_at) VALUES(?,?,?,?)').bind(id,JSON.stringify({...input,...extra}),state,t).run();
}
const pending=await operatorPendingSkOrders(d,[sender,other],sender.id);
assert.deepEqual(pending,[{id:'901',name:input.name,at:t,reason:'Ожидает разрешения администратора',canDecide:false,sender:''}]);
assert.deepEqual((await operatorPendingSkOrders(d,[sender,other],other.id)).map(r=>r.id),['902']);
assert.deepEqual(await operatorPendingSkOrders(d,[{...sender,accessEnabled:false},other],sender.id),[]);
assert.deepEqual(await operatorPendingSkOrders(d,[sender,{...other,skLogin:sender.skLogin}],sender.id),[]);
await d.prepare("UPDATE sk_order_transfers SET state='imported' WHERE id='901'").run();
assert.deepEqual(await operatorPendingSkOrders(d,[sender,other],sender.id),[]);

d.close();console.log('SK orders: assignment, sheet K, duplicate delivery, conflict approval, address preservation, unknown/disabled sender, permissions, polling and provider errors passed');

const {skOrderReview}=await import('../lib/sk-order-review.ts');
const reviewClient={id:'review',owner:'owner',sheet:'ЧС'},reviewOwner={id:'owner',name:'Иван Иванов',login:'OP_Ivan'};
const review=skOrderReview(null,{id:'sender'},reviewClient,reviewOwner,[{id:'SK-123',clientId:'review',status:'draft'},{id:'SK-124',clientId:'review',status:'shipping'},{id:'SK-125',clientId:'review',status:'refused'}]);
assert.equal(review.ownerLabel,'Иван Иванов · OP_Ivan');
assert.deepEqual(review.activeOrderIds,['SK-123','SK-124']);
assert.equal(review.reasons.length,4);
assert.equal(review.reasons[1],'Есть действующие заказы: SK-123 — Новый, SK-124 — Отправлен');
assert.equal(skOrderReview('project',{id:'owner'},reviewClient,reviewOwner,[{id:'SK-126',clientId:'review',status:'packing'}]).reasons[0],'Есть действующие заказы: SK-126 — Принят');
assert.match(review.reasons[0],/Иван Иванов/);
assert.ok(review.reasons.includes('Создан не из Проекта'));
assert.equal(skOrderReview('project',{id:'owner'},reviewClient,reviewOwner,[]).ownerLabel,review.ownerLabel);
assert.deepEqual(skOrderReview('project',{id:'sender'},undefined,undefined,[]).reasons,[]);

assert.equal(review.ownerIsSender,false);
const ownReview=skOrderReview('project',{id:'owner'},{...reviewClient,sheet:'К'},reviewOwner,[{id:'SK-124',clientId:'review',status:'shipping'}]);
assert.equal(ownReview.ownerIsSender,true);
assert.deepEqual(ownReview.reasons,['Есть действующие заказы: SK-124 — Отправлен']);
assert.equal(skOrderReview('project',undefined,reviewClient,reviewOwner,[]).ownerIsSender,false);


const artem={...head,id:'E-74ee9a8f-99d'};
assert.equal(skMayDecide(artem,sender,other),true);
for(const method of ['GET','POST'])assert.equal(mayCallEndpoint(artem,new URL('https://crm/api/sk-orders'),method,{}),true);
assert.equal(skMayDecide({...artem,role:'operator'},sender,other),false);
assert.equal(skMayDecide({...head,login:'SKP_Artem'},sender,other),false);
