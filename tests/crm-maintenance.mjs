import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../server/sqlite.ts';
import {runCrmMaintenance,maintenanceHealthy} from '../lib/crm-maintenance.ts';
const d=openDatabase(':memory:');
try{
 for(const sql of readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8').split('--> statement-breakpoint'))await d.prepare(sql).run();
 await d.prepare("INSERT INTO settings VALUES('main','{\"retentionDays\":30}')").run();
 const now=new Date().toISOString();
 const employee={id:'operator',login:'operator',name:'Operator',role:'operator',department:'1',salary:0,bonus:1};
 await d.prepare('INSERT INTO employees(id,data) VALUES(?,?)').bind(employee.id,JSON.stringify(employee)).run();
 for(const [id,status,createdAt] of [['expired','draft','2020-01-01T00:00:00Z'],['active','draft',now],['unpaid','redeemed','2020-01-01T00:00:00Z']]){
  const c={id,name:'Иван Иванов',phone:id,source:'test',owner:employee.id,assignedUntil:'2020-02-01T00:00:00Z',assignmentStartedAt:createdAt,createdAt,version:1};
  const o={id,clientId:id,manager:employee.id,logistic:'',status,items:[],comment:'',reason:'',contact:'none',due:'',round:0,extra:false,createdAt,updatedAt:createdAt,draftHours:24,...(status==='redeemed'?{redeemedAt:createdAt}:{})};
  await d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind(id,id,JSON.stringify(c)).run();
  await d.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').bind(id,id,JSON.stringify(o)).run();
 }
 assert.equal(await maintenanceHealthy(d),false);
 await d.prepare("INSERT INTO settings VALUES('crm-maintenance-health',?)").bind(JSON.stringify({ok:true,at:now})).run();assert.equal(await maintenanceHealthy(d),true);assert.equal(await maintenanceHealthy(d,Date.parse(now)+30000),false);
 const result=await runCrmMaintenance(d);assert.equal(result.ordersChanged,true);
 const read=async(table,id)=>JSON.parse((await d.prepare(`SELECT data FROM ${table} WHERE id=?`).bind(id).first()).data);
 assert.equal((await read('orders','expired')).status,'refused');assert.equal((await read('orders','active')).status,'draft');
 assert.equal((await read('clients','unpaid')).owner,'operator','unpaid premium must retain ownership');
 assert.equal((await read('clients','active')).owner,'operator','active order must retain ownership');
 assert.equal((await read('clients','expired')).owner,'');
 assert.equal((await d.prepare("SELECT COUNT(*) AS n FROM reminders WHERE id LIKE 'draft:active:%'").first()).n,1);
 const events=(await d.prepare('SELECT COUNT(*) AS n FROM events').first()).n;
 const again=await runCrmMaintenance(d);assert.equal(again.ordersChanged,false);assert.equal(again.clientsChanged,false);assert.equal((await d.prepare('SELECT COUNT(*) AS n FROM events').first()).n,events);
 console.log('Maintenance: deadline cancellation, active/unpaid retention, reminders and idempotency passed');
}finally{d.close();}
