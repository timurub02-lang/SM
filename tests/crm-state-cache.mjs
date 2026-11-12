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
