import assert from 'node:assert/strict';
import {openDatabase} from '../server/sqlite.ts';
import {paidOrderNoticeStatements} from '../lib/paid-order-notice.ts';
const d=openDatabase(':memory:');
await d.prepare('CREATE TABLE employees(id TEXT PRIMARY KEY,data TEXT)').run();
await d.prepare('CREATE TABLE clients(id TEXT PRIMARY KEY,data TEXT)').run();
await d.prepare('CREATE TABLE orders(id TEXT PRIMARY KEY,data TEXT)').run();
for(const e of [{id:'op',role:'operator',department:'a'},{id:'head',role:'department_head',department:'a'},{id:'other',role:'department_head',department:'b'}])await d.prepare('INSERT INTO employees VALUES(?,?)').bind(e.id,JSON.stringify(e)).run();
await d.prepare('INSERT INTO clients VALUES(?,?)').bind('c',JSON.stringify({name:'Тестовый клиент'})).run();
for(const delivery of ['cdek_pickup','russian_post','moscow_courier']){
 const before={id:delivery,clientId:'c',manager:'op',status:'shipping',delivery,items:[{quantity:2,price:4500}]},after={...before,status:'redeemed',_mutation:'ok'};
 await d.prepare('INSERT INTO orders VALUES(?,?)').bind(after.id,JSON.stringify(after)).run();
 const stale=await paidOrderNoticeStatements(d,before,after,'stale','2026-11-12');await d.batch(stale);
 assert.equal((await d.prepare('SELECT * FROM reminders WHERE id=?').bind('order-paid:'+after.id).all()).results.length,0);
 const writes=await paidOrderNoticeStatements(d,before,after,'ok','2026-11-12');await d.batch(writes);await d.batch(writes);
 const rows=(await d.prepare('SELECT employee_id,data FROM reminders WHERE id=? ORDER BY employee_id').bind('order-paid:'+after.id).all()).results;
 assert.deepEqual(rows.map(r=>r.employee_id),['head','op']);
 assert.match(JSON.parse(rows[0].data).text,/9\s000 ₽/);
 assert.deepEqual(await paidOrderNoticeStatements(d,after,after,'ok','now'),[]);
}
console.log('Paid notices: all delivery methods, recipients, transaction guard and repeat protection passed');

const {maintainReminders}=await import('../lib/reminder-maintenance.ts');
await d.prepare('DELETE FROM reminders').run();
for(const kind of ['order-paid','client-released'])for(let i=0;i<21;i++){
 const notice={kind,id:kind+':'+i,clientId:'c',title:kind,text:'',at:new Date(Date.UTC(2026,10,1,0,i)).toISOString()};
 await d.prepare('INSERT INTO reminders(employee_id,id,data,at) VALUES(?,?,?,?)').bind('op',notice.id,JSON.stringify(notice),notice.at).run();
}
await maintainReminders(d,{employees:[{id:'op',role:'operator'}],clients:[],orders:[],settings:{}},'op');
for(const kind of ['order-paid','client-released'])assert.equal((await d.prepare("SELECT COUNT(*) n FROM reminders WHERE json_extract(data,'$.kind')=?").bind(kind).first()).n,20,'each event history retains its own 20 records');
