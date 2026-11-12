import assert from 'node:assert/strict';
import {openDatabase} from '../server/sqlite.ts';
import {initBaseStorage} from '../lib/base-storage.ts';
const d=openDatabase(':memory:');
try{
 await d.prepare('CREATE TABLE clients(id TEXT PRIMARY KEY,phone TEXT UNIQUE,data TEXT,version INTEGER DEFAULT 1)').run();await d.prepare('CREATE TABLE settings(id TEXT PRIMARY KEY,data TEXT)').run();
 const rows=Array.from({length:2000},(_,i)=>({id:'c'+i,phone:'7999'+String(i).padStart(7,'0'),linkedPhones:['7888'+String(i).padStart(7,'0')]}));
 await d.batch(rows.map(c=>d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind(c.id,c.phone,JSON.stringify(c))));
 const before=(await d.prepare('SELECT * FROM clients ORDER BY id').all()).results;
 await initBaseStorage(d);await initBaseStorage(d);
 assert.deepEqual((await d.prepare('SELECT * FROM clients ORDER BY id').all()).results,before,'backfill must not edit client data or versions');
 assert.equal((await d.prepare('SELECT COUNT(*) AS n FROM client_phone_index').first()).n,4000);
 const plan=(await d.prepare('EXPLAIN QUERY PLAN DELETE FROM client_phone_index WHERE client_id=?').bind('c1').all()).results.map(r=>r.detail).join('\n');
 assert.match(plan,/SEARCH .*idx_client_phone_client/,'trigger deletes must use a client lookup, not scan the whole phone table');
 await d.prepare("UPDATE clients SET data=json_set(data,'$.linkedPhones',json('[]')) WHERE id='c1'").run();
 assert.equal((await d.prepare('SELECT COUNT(*) AS n FROM client_phone_index WHERE client_id=?').bind('c1').first()).n,1);
 console.log('Phone backfill: indexed trigger lookup, unchanged client JSON/version, idempotency and removed linked phone passed');
}finally{d.close();}
