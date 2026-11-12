import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDatabase} from '../server/sqlite.ts';
const d=openDatabase(':memory:');
try {
 await d.prepare('CREATE TABLE items(id INTEGER PRIMARY KEY, value TEXT UNIQUE)').run();
 await d.batch([d.prepare('INSERT INTO items VALUES(?,?)').bind(1,'first'),d.prepare('INSERT INTO items VALUES(?,?)').bind(2,'second')]);
 assert.equal(await d.prepare('SELECT value FROM items WHERE id=?').bind(1).first('value'),'first');
 await assert.rejects(d.batch([d.prepare('INSERT INTO items VALUES(3,?)').bind('third'),d.prepare('INSERT INTO items VALUES(4,?)').bind('first')]));
 assert.equal((await d.prepare('SELECT * FROM items').all()).results.length,2);
 assert.equal((await d.prepare('UPDATE items SET value=? WHERE id=?').bind('updated',1).run()).meta.changes,1);
 assert.equal(await d.prepare('SELECT * FROM items WHERE id=3').first(),null);
 let completed=0,servedAt=-1,timerProgress=0;const total=8000,pending=setImmediate(()=>{servedAt=completed;}),pulse=setInterval(()=>{if(completed>0&&completed<total)timerProgress++;},1);
 try {await Promise.all(Array.from({length:4},async()=>{for(let i=0;i<2000;i++){await d.prepare('SELECT 1').first();completed++;}}));assert.ok(servedAt>=0&&servedAt<total,'parallel query chains must yield to pending phone/HTTP work');assert.ok(timerProgress>0,'timers must keep progressing during query chains');}
 finally {clearImmediate(pending);clearInterval(pulse);}
 console.log('SQLite: reads, writes, transaction rollback and request fairness passed');
} finally { d.close(); }

// Prepared SQL is reused, but bindings, rows and schema metadata must never be cached.
const cached=openDatabase(':memory:');
const nativePrepare=DatabaseSync.prototype.prepare,preparations=new Map();
DatabaseSync.prototype.prepare=function(sql,...options){
 preparations.set(sql,(preparations.get(sql)??0)+1);
 return nativePrepare.call(this,sql,...options);
};
const select=cached.prepare('SELECT ? AS a, ? AS b');
try {
 assert.deepEqual({...await select.bind(1,'first').first()},{a:1,b:'first'});
 assert.deepEqual({...await select.bind(2,'second').first()},{a:2,b:'second'});
 assert.deepEqual({...((await select.bind(3).all()).results[0])},{a:3,b:null},'omitted bindings must clear prior values');
 assert.equal(preparations.get(select.sql),1,'first/all must share prepared SQL');
 await cached.prepare('CREATE TABLE reuse(id INTEGER PRIMARY KEY, value TEXT UNIQUE)').run();
 const insert=cached.prepare('INSERT INTO reuse VALUES(?,?)'),rows=cached.prepare('SELECT * FROM reuse ORDER BY id');
 await insert.bind(1,'first').run();
 await assert.rejects(cached.batch([insert.bind(2,'second'),insert.bind(3,'first')]));
 await insert.bind(2,'second').run();
 assert.equal(preparations.get(insert.sql),1,'a failed transaction must leave cached statements reusable');
 assert.deepEqual((await rows.all()).results.map(row=>({...row})),[{id:1,value:'first'},{id:2,value:'second'}]);
 await cached.prepare("ALTER TABLE reuse ADD COLUMN extra TEXT DEFAULT 'added'").run();
 assert.equal((await rows.first()).extra,'added','cached SELECT must reprepare after ALTER');
 await cached.prepare('DROP TABLE reuse').run();
 await assert.rejects(rows.all(),/no such table/);
 await cached.prepare('CREATE TABLE reuse(id INTEGER PRIMARY KEY, replacement INTEGER)').run();
 await cached.prepare('INSERT INTO reuse VALUES(9,42)').run();
 assert.deepEqual({...await rows.first()},{id:9,replacement:42},'cached SELECT must recover after drop/recreate');
 assert.equal(preparations.get(rows.sql),1,'schema changes should use native automatic reprepare');
} finally {cached.close();DatabaseSync.prototype.prepare=nativePrepare;}
await assert.rejects(select.bind(4,'closed').first(),/not open|finalized/);
await assert.rejects(cached.prepare('SELECT 1').all(),/not open|finalized/);

const lru=openDatabase(':memory:');
preparations.clear();
DatabaseSync.prototype.prepare=function(sql,...options){
 preparations.set(sql,(preparations.get(sql)??0)+1);
 return nativePrepare.call(this,sql,...options);
};
try {
 for(let i=0;i<256;i++) await lru.prepare(`SELECT ${i} AS value`).first();
 await lru.prepare('SELECT 0 AS value').first();
 await lru.prepare('SELECT 256 AS value').first();
 await lru.prepare('SELECT 0 AS value').first();
 assert.equal(preparations.get('SELECT 0 AS value'),1,'recently used SQL must remain cached');
 await lru.prepare('SELECT 1 AS value').first();
 assert.equal(preparations.get('SELECT 1 AS value'),2,'the 257th SQL must evict the least recently used entry');
} finally {lru.close();DatabaseSync.prototype.prepare=nativePrepare;}
console.log('SQLite statement cache: bindings, schema changes, rollback reuse, 256-entry LRU and close passed');

// A background writer must not freeze timers, reads or phone authorization.
const folder=mkdtempSync(join(tmpdir(),'crm-sqlite-busy-')),file=join(folder,'test.sqlite');
const shared=openDatabase(file),writer=new DatabaseSync(file);
try {
 await shared.prepare('CREATE TABLE items(id INTEGER PRIMARY KEY,value TEXT)').run();
 writer.exec('BEGIN IMMEDIATE');
 let timerRan=false;
 const release=setTimeout(()=>{timerRan=true;writer.exec('COMMIT');},150);
 try {
  await Promise.all([
   shared.batch([shared.prepare("INSERT INTO items VALUES(1,'first')"),shared.prepare("INSERT INTO items VALUES(2,'second')")]),
   shared.prepare("INSERT INTO items VALUES(3,'third')").run(),
  ]);
 } finally {clearTimeout(release);if(!timerRan)writer.exec('ROLLBACK');}
 assert.equal(timerRan,true,'database lock must yield to HTTP/event-loop work');
 assert.equal((await shared.prepare('SELECT * FROM items').all()).results.length,3);
 const firstRow=shared.prepare('SELECT * FROM items ORDER BY id');
 const writeFirst=shared.prepare('UPDATE items SET value=? WHERE id=1');
 for(let i=0;i<10;i++){
  assert.equal((await firstRow.first()).id,1);
  writer.prepare('UPDATE items SET value=? WHERE id=1').run(`external-${i}`);
  assert.equal(writer.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get().busy,0,'cached first() must release its read cursor after ROW');
  await writeFirst.bind(`local-${i}`).run();
  assert.equal((await firstRow.first()).value,`local-${i}`);
  writer.prepare('UPDATE items SET value=? WHERE id=1').run(`external-batch-${i}`);
  await shared.batch([writeFirst.bind(`batch-${i}`)]);
  assert.equal((await firstRow.first()).value,`batch-${i}`);
  await shared.readSnapshot(async()=>{
   assert.equal((await firstRow.first()).value,`batch-${i}`);
   writer.prepare('UPDATE items SET value=? WHERE id=1').run(`during-snapshot-${i}`);
   assert.equal((await firstRow.first()).value,`batch-${i}`,'an explicit read snapshot must remain consistent');
  });
  assert.equal((await firstRow.first()).value,`during-snapshot-${i}`,'ending a snapshot must release the old view');
  await writeFirst.bind(`after-snapshot-${i}`).run();
  await shared.batch([writeFirst.bind(`after-snapshot-batch-${i}`)]);
 }
 console.log('SQLite cached cursor: external commits, WAL checkpoints and read-snapshot release passed');
 writer.exec('BEGIN IMMEDIATE');
 let ticks=0;const pulse=setInterval(()=>ticks++,25);const start=performance.now();
 try {await assert.rejects(shared.prepare("INSERT INTO items VALUES(4,'timeout')").run(),e=>(e.errcode&255)===5);}
 finally {clearInterval(pulse);writer.exec('ROLLBACK');}
 assert.ok(ticks>20,'bounded lock wait must keep event loop responsive');
 assert.ok(performance.now()-start<8000,'lock retry must remain bounded');
 assert.equal(await shared.prepare('SELECT * FROM items WHERE id=4').first(),null);
 console.log('SQLite lock contention: async retry, concurrent atomic writes and bounded wait passed');
} finally {writer.close();shared.close();rmSync(folder,{recursive:true,force:true});}
