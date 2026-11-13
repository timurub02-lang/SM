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
 for(const [i,kind] of ['expired','recent','active','unpaid','missing-date','explicit-current','legacy-paid','legacy-recent','legacy-active','legacy-unpaid','legacy-missing-date','legacy-current','prior-paid','review-only'].entries()){
  const c={id:kind,phone:'+7999000'+String(i).padStart(4,'0'),name:'Иванов Иван Иванович',owner:'op',sheet:'К',assignedUntil:'',createdAt:old,version:1};clients.push(c);
  const o={id:'LV-'+i,clientId:c.id,manager:'op',status:'redeemed',createdAt:old,redeemedAt:kind.endsWith('missing-date')?undefined:kind.endsWith('recent')?new Date(now-86400000).toISOString():old,items:[],version:1,...(['explicit-current','legacy-current'].includes(kind)?{importedPayment:{periodId:'2026-11-2'}}:{})};if(kind.startsWith('legacy-'))o.legacyLv={status:'Выплачен'};if(kind==='prior-paid')o.priorPremiumPaid={source:'Admin confirmation',at:old};if(kind==='review-only')o.legacyLv={status:'Оплачен',paymentPendingReview:true};orders.push(o);if(!kind.startsWith('legacy-')&&!['prior-paid','review-only'].includes(kind))history.orders.push({externalId:String(i),period:'2026-09-1'});
  if(kind.endsWith('active')||kind.endsWith('unpaid'))orders.push({...o,id:kind+'-new',legacyLv:undefined,status:kind.endsWith('active')?'shipping':'redeemed'});
  await d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind(c.id,c.phone,JSON.stringify(c)).run();
 }
 for(const o of orders)await d.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').bind(o.id,o.clientId,JSON.stringify(o)).run();
 await d.prepare('INSERT INTO settings(id,data) VALUES(?,?)').bind('premium-paid-history',JSON.stringify(history)).run();
 const before=(await d.prepare('SELECT data FROM orders ORDER BY id').all()).results;
 await reconcileClients(d,clients,orders);
 const result=(await d.prepare('SELECT data FROM clients').all()).results.map(r=>JSON.parse(r.data));
 const released=['expired','legacy-paid','prior-paid'];for(const id of released)assert.equal(result.find(c=>c.id===id).owner,'',id);
 for(const c of result.filter(c=>!released.includes(c.id)))assert.equal(c.owner,'op',c.id+' remains protected');
 assert.deepEqual((await d.prepare('SELECT data FROM orders ORDER BY id').all()).results,before,'Orders and payout history remain unchanged');
 const staged=applyPremiumStages(null,orders,[],history),recent=result.find(c=>c.id==='recent');
 assert.equal(staged[0].premiumStage.status,'paid');
 assert.equal(staged.find(o=>o.clientId==='explicit-current').premiumStage,undefined);
 assert.match(clientRetentionLabel(recent,staged,now),/^До открепления:/);
 const preview=clientRetentionPreview(result,staged,config,now);assert.equal(preview.recent,undefined);assert.equal(preview['legacy-recent'],undefined);assert.match(clientRetentionLabel(result.find(c=>c.id==='legacy-recent'),staged,now),/^До открепления:/);assert.equal(preview['legacy-current'].expiresAfterPremium,true);assert.equal(preview['review-only'].expiresAfterPremium,true);
 assert.equal(JSON.parse((await d.prepare("SELECT data FROM settings WHERE id='premium-paid-history'").first()).data).orders.length,6);
 console.log('Historical paid orders release expired clients; active, unpaid, current import, missing date and live retention stay protected; UI agrees; source orders unchanged');
}finally{d.close();}
