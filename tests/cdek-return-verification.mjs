import assert from 'node:assert/strict';
import {openDatabase} from '../server/sqlite.ts';
import {initRedemption,inRedemptionTab,compareRedemptionRows} from '../lib/redemption.ts';
import {syncCdekReturns,verifiedReturn} from '../lib/cdek-return-verification.ts';
import {returnedOrderHidden} from '../lib/order-premium-stage.ts';
import {cdekStatusPatch} from '../lib/cdek-sync.ts';
const d=openDatabase(':memory:'),originalUuid=crypto.randomUUID(),returnUuid=crypto.randomUUID();
const original={entity:{uuid:originalUuid,cdek_number:'111'},related_entities:[{type:'return_order',uuid:returnUuid,cdek_number:'222'}]};
const returned={entity:{uuid:returnUuid,cdek_number:'222',is_return:true},related_entities:[{type:'direct_order',uuid:originalUuid,cdek_number:'111'}]};
assert.equal(verifiedReturn(original,returned,originalUuid,'111','222'),returnUuid);
assert.deepEqual([{id:'old-pending',result:'returned',returnConfirmedAt:'2026-11-01'},{id:'unconfirmed',result:'to_return'}].sort((a,b)=>compareRedemptionRows(a,b,'returns','2026-11-16')).map(r=>r.id),['unconfirmed','old-pending']);
for(const patch of [{entity:{...returned.entity,is_return:false}},{related_entities:[]},{entity:{...returned.entity,cdek_number:'333'}}])assert.throws(()=>verifiedReturn(original,{...returned,...patch},originalUuid,'111','222'));
assert.throws(()=>verifiedReturn({...original,related_entities:[]},returned,originalUuid,'111','222'));
let mode='wrong',race=false;
const request=async(url)=>{
 if(url.includes('/oauth/'))return Response.json({access_token:'synthetic-only',expires_in:3600});
 if(mode==='http')return Response.json({}, {status:503});
 if(url.includes('?')){
  if(race)await d.prepare("UPDATE redemption_entries SET data=json_set(data,'$.returnWaybill','333'),version=version+1 WHERE order_id='o'").run();
  return Response.json(mode==='wrong'?{...returned,related_entities:[]}:returned);
 }
 return Response.json(mode==='absent'?{...original,related_entities:[]}:mode==='multiple'?{...original,related_entities:[...original.related_entities,{type:'return_order',uuid:crypto.randomUUID(),cdek_number:'444'}]}:original);
};
try{
 await d.batch(['CREATE TABLE settings(id TEXT PRIMARY KEY,data TEXT)','CREATE TABLE clients(id TEXT PRIMARY KEY,data TEXT)','CREATE TABLE orders(id TEXT PRIMARY KEY,client_id TEXT,data TEXT,version INTEGER DEFAULT 1)','CREATE TABLE events(id TEXT PRIMARY KEY,client_id TEXT,order_id TEXT,at TEXT,data TEXT)'].map(s=>d.prepare(s)));
 await initRedemption(d);
 const order={paymentReceivedAt:'2026-11-02T10:00:00Z',paymentReceivedAmount:1234,priorPremiumPaid:{at:'2026-11-03',source:'synthetic'},id:'o',clientId:'c',status:'shipping',delivery:'cdek_pickup',items:[{name:'Product',quantity:2}],manager:'op',version:1,createdAt:'2026-11-01',updatedAt:'2026-11-01'};
 await d.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)').bind('o','c',JSON.stringify(order)).run();
 await d.prepare('INSERT INTO settings VALUES(?,?)').bind('cdek-1',JSON.stringify({clientId:'synthetic',clientSecret:'synthetic'})).run();
 await d.prepare('INSERT INTO settings VALUES(?,?)').bind('cdek-shipment-o',JSON.stringify({slot:1,uuid:originalUuid,number:'111'})).run();
 await d.prepare('INSERT INTO redemption_entries(order_id,entered_at,data) VALUES(?,?,?)').bind('o','2026-11-01',JSON.stringify({result:'returned',returnWaybill:'222',returnVerifiedAt:'old-manual-verification'})).run();
 const entry=async()=>JSON.parse((await d.prepare("SELECT data FROM redemption_entries WHERE order_id='o'").first()).data);
 const readOrder=async()=>JSON.parse((await d.prepare("SELECT data FROM orders WHERE id='o'").first()).data);
 assert(inRedemptionTab(await entry(),'returns','2026-11-16'));
 assert.equal((await syncCdekReturns(d,request)).failed,1);assert.equal((await readOrder()).status,'shipping');assert.equal((await entry()).returnCheck.state,'error');
 mode='http';await syncCdekReturns(d,request);assert.equal((await readOrder()).status,'shipping');assert(inRedemptionTab(await entry(),'returns','2026-11-17'));
 mode='ok';race=true;assert.equal((await syncCdekReturns(d,request)).verified,0);assert.equal((await readOrder()).status,'shipping');assert.equal((await entry()).returnWaybill,'333');
 race=false;await d.prepare("UPDATE redemption_entries SET data=json_set(data,'$.returnWaybill','222')").run();
 assert.equal((await syncCdekReturns(d,request)).verified,1);
 const done=await readOrder();assert.equal(done.status,'returned');assert.equal(done.warehouseReturnedAt,undefined);assert.deepEqual(done.items,order.items);assert.equal((await entry()).returnCheck.state,'verified');assert(!inRedemptionTab(await entry(),'returns','2026-11-16'));
 for(const role of ['admin','operator','department_head'])assert(returnedOrderHidden(done,role));
 assert(!returnedOrderHidden(done,'logistic'));assert(returnedOrderHidden({...done,warehouseReturnedAt:'2026-11-16T10:00:00Z'},'logistic',Date.parse('2026-11-18T10:00:00Z')));
 assert.equal((await syncCdekReturns(d,request)).checked,0);assert.equal((await d.prepare('SELECT count(*) n FROM events').first()).n,1);
 assert.equal(cdekStatusPatch(done,{statuses:[{code:'DELIVERED',date_time:'2026-11-16T12:00:00Z'}]},{DELIVERED:'paid'},'revision')?.status,undefined);
 // Automatic discovery only starts in Confirm return; no manual number is required.
 await d.prepare("UPDATE orders SET data=?,version=version+1 WHERE id='o'").bind(JSON.stringify(order)).run();
 await d.prepare("UPDATE redemption_entries SET data=?,version=version+1 WHERE order_id='o'").bind(JSON.stringify({action:'refusal',result:'to_return'})).run();
 mode='absent';assert.equal((await syncCdekReturns(d,request)).verified,0);assert.equal((await entry()).result,'to_return');assert.equal((await entry()).returnWaybill,undefined);assert.equal((await entry()).returnCheck.state,'pending');
 const hourPassed=()=>d.prepare("UPDATE redemption_entries SET data=json_set(data,'$.returnCheck.at',strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour'))").run();
 assert.deepEqual(await syncCdekReturns(d,request),{checked:0,verified:0,failed:0});
 await hourPassed();mode='multiple';assert.equal((await syncCdekReturns(d,request)).failed,1);assert.equal((await readOrder()).status,'shipping');assert.equal((await entry()).returnWaybill,undefined);
 await hourPassed();mode='wrong';assert.equal((await syncCdekReturns(d,request)).failed,1);assert.equal((await readOrder()).status,'shipping');assert.equal((await entry()).returnWaybill,undefined);
 await hourPassed();mode='ok';assert.equal((await syncCdekReturns(d,request)).verified,1);assert.equal((await entry()).returnWaybill,'222');assert.equal((await entry()).result,'returned');assert.equal((await readOrder()).status,'returned');assert.equal((await readOrder()).warehouseReturnedAt,undefined);assert.equal((await readOrder()).paymentReceivedAmount,order.paymentReceivedAmount);assert.equal((await readOrder()).paymentReceivedAt,order.paymentReceivedAt);assert.deepEqual((await readOrder()).priorPremiumPaid,order.priorPremiumPaid);
 assert.equal((await syncCdekReturns(d,request)).checked,0);
 await d.prepare("UPDATE redemption_entries SET data=? WHERE order_id='o'").bind(JSON.stringify({result:'courier'})).run();
 assert.equal((await syncCdekReturns(d,request)).checked,0,'Main-table orders are not discovered');
 console.log('CDEK return verification: bidirectional identity, retry, legacy manual marks, race, exactly-once transition, no warehouse receipt, scope and 48h archive passed');
}finally{d.close();}
