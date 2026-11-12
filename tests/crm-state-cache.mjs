import assert from 'node:assert/strict';
import {openDatabase} from '../server/sqlite.ts';
import {cachedCrmState} from '../lib/crm-state-cache.ts';
import {seed} from '../lib/crm.ts';
const d=openDatabase(':memory:');
try{
 await d.prepare('CREATE TABLE orders(id TEXT,data TEXT)').run();let reads=0;
 const read=async()=>{reads++;return seed();};
 const [one,two]=await Promise.all([cachedCrmState(d,read),cachedCrmState(d,read)]);assert.equal(reads,1);assert.notEqual(one,two);
 one.retentionPreview={test:{until:'never'}};assert.equal((await cachedCrmState(d,read)).retentionPreview,undefined);
 await d.prepare("INSERT INTO orders VALUES('one','{}')").run();await cachedCrmState(d,read);assert.equal(reads,2);
 console.log('Shared source cache: combined reads, mutation invalidation and per-response metadata isolation passed');
}finally{d.close();}

// Imports can advance the revision while a snapshot is loading. Keep only one read in flight.
const busy=openDatabase(':memory:');
try{
 await busy.prepare('CREATE TABLE orders(id TEXT,data TEXT)').run();
 let release,active=0,peak=0,reads=0;
 const read=async()=>{reads++;active++;peak=Math.max(peak,active);if(reads===1)await new Promise(r=>release=r);active--;return seed();};
 const first=cachedCrmState(busy,read);
 while(!release)await new Promise(r=>setImmediate(r));
 await busy.prepare("INSERT INTO orders VALUES('new','{}')").run();
 const waiting=Array.from({length:12},()=>cachedCrmState(busy,read));
 await new Promise(r=>setTimeout(r,20));assert.equal(reads,1);
 release();await Promise.all([first,...waiting]);assert.equal(peak,1);assert.equal(reads,2);
 await busy.prepare("INSERT INTO orders VALUES('failure','{}')").run();
 await assert.rejects(cachedCrmState(busy,async()=>{throw Error('read failed');}));
 await cachedCrmState(busy,read);assert.equal(reads,3);
 console.log('Snapshot churn: one in-flight read, fresh revision and failure recovery passed');
}finally{busy.close();}
