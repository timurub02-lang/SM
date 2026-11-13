import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../server/sqlite.ts';
import {reconcileClients} from '../lib/base-retention-store.ts';
import {applyPremiumStages} from '../lib/premium-ledger.ts';
import {clientRetentionLabel} from '../lib/client-retention-label.ts';
import {clientRetentionPreview} from '../lib/client-retention-preview.ts';
import {initialBaseSettings} from '../lib/base-policy.ts';
const d=openDatabase(':memory:'),now=Date.now(),old=new Date(now-60*86400000).toISOString();
try{
 for(const sql of readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8').split('--> statement-breakpoint'))await d.prepare(sql).run();
 const config=initialBaseSettings();config.retention.operators.op={mode:'fixed',days:14,defaultWeeks:2,bands:[]};
 await d.prepare('INSERT INTO settings(id,data) VALUES(?,?)').bind('base-settings',JSON.stringify({config})).run();
 const history={source:'historical.xlsx',sha256:'test',orders:[]};
 const clients=[],orders=[];
 for(const [i,kind] of ['expired','recent','active','unpaid','missing-date','explicit-current'].entries()){
  const c={id:kind,phone:'+7999000'+String(i).padStart(4,'0'),name:'Иванов Иван Иванович',owner:'op',sheet:'К',assignedUntil:'',createdAt:old,version:1};clients.push(c);
  const o={id:'LV-'+i,clientId:c.id,manager:'op',status:'redeemed',createdAt:old,redeemedAt:kind==='missing-date'?undefined:kind==='recent'?new Date(now-86400000).toISOString():old,items:[],version:1,...(kind==='explicit-current'?{importedPayment:{periodId:'2026-11-2'}}:{})};orders.push(o);history.orders.push({externalId:String(i),period:'2026-09-1'});
  if(kind==='active'||kind==='unpaid')orders.push({...o,id:kind+'-new',status:kind==='active'?'shipping':'redeemed'});
  await d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind(c.id,c.phone,JSON.stringify(c)).run();
 }
 for(const o of orders)await d.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').bind(o.id,o.clientId,JSON.stringify(o)).run();
 await d.prepare('INSERT INTO settings(id,data) VALUES(?,?)').bind('premium-paid-history',JSON.stringify(history)).run();
 const before=(await d.prepare('SELECT data FROM orders ORDER BY id').all()).results;
 await reconcileClients(d,clients,orders);
 const result=(await d.prepare('SELECT data FROM clients').all()).results.map(r=>JSON.parse(r.data));
 assert.equal(result.find(c=>c.id==='expired').owner,'');
 for(const c of result.filter(c=>c.id!=='expired'))assert.equal(c.owner,'op',c.id+' remains protected');
 assert.deepEqual((await d.prepare('SELECT data FROM orders ORDER BY id').all()).results,before,'Orders and payout history remain unchanged');
 const staged=applyPremiumStages(null,orders,[],history),recent=result.find(c=>c.id==='recent');
 assert.equal(staged[0].premiumStage.status,'paid');
 assert.equal(staged.find(o=>o.clientId==='explicit-current').premiumStage,undefined);
 assert.match(clientRetentionLabel(recent,staged,now),/^До открепления:/);
 assert.equal(clientRetentionPreview(result,staged,config,now).recent,undefined);
 assert.equal(JSON.parse((await d.prepare("SELECT data FROM settings WHERE id='premium-paid-history'").first()).data).orders.length,6);
 console.log('Historical paid orders release expired clients; active, unpaid, current import, missing date and live retention stay protected; UI agrees; source orders unchanged');
}finally{d.close();}
