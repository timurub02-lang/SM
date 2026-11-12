import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {snapshotOrder,snapshotOrdersQuery} from '../lib/snapshot-orders.ts';
const db=new DatabaseSync(':memory:');
db.exec('CREATE TABLE orders(id TEXT PRIMARY KEY,data TEXT,version INTEGER);CREATE TABLE settings(id TEXT PRIMARY KEY,data TEXT)');
const expected=[];
let i=0;
for(const state of [undefined,'new','ready','deleting','failed'])for(const number of [undefined,null,'',0,false,true,123,'SYNTHETIC'])for(const downloadedAt of [undefined,null,'',false,'2026-11-01']){
 const id=String(i++).padStart(4,'0'),testOnly=i%2===0,order={id,version:1,testOnly,cdekExported:true,cdekTrackingNumber:'stale',cdekDeleting:true,cdekWaybillReceived:true,comment:'preserved',nested:{value:1}};
 db.prepare('INSERT INTO orders VALUES(?,?,?)').run(id,JSON.stringify(order),7);
 if(state!==undefined)db.prepare('INSERT INTO settings VALUES(?,?)').run('cdek-shipment-'+id,JSON.stringify({state,number,downloadedAt}));
 const active=state==='ready'||state==='deleting',sqlNumber=typeof number==='boolean'?Number(number):number;
 expected.push({...order,version:7,cdekTrackingNumber:active&&sqlNumber?String(sqlNumber):undefined,cdekExported:active&&number!=null||testOnly,cdekDeleting:state==='deleting',cdekWaybillReceived:state!==undefined&&downloadedAt!=null});
}
assert.deepEqual(db.prepare(snapshotOrdersQuery).all().map(snapshotOrder),expected.reverse());
const plan=db.prepare('EXPLAIN QUERY PLAN '+snapshotOrdersQuery).all().map(r=>r.detail);
assert.equal(plan.filter(s=>s.includes('SEARCH s USING INDEX')).length,1);
assert.ok(!plan.some(s=>s.includes('CORRELATED')));
assert.throws(()=>snapshotOrder({data:'invalid',version:1}));
db.close();
console.log('PASS: snapshot shipment projection, test-only fallback, SQL null/boolean semantics, versions and one indexed lookup');
