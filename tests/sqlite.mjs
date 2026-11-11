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
 let served=false;const pending=setImmediate(()=>{served=true;});
 try {for(let i=0;i<50;i++)await d.prepare('SELECT 1').first();assert.equal(served,true,'ordinary query chains must yield to pending phone/HTTP work');}
 finally {clearImmediate(pending);}
 console.log('SQLite: reads, writes, transaction rollback and request fairness passed');
} finally { d.close(); }

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
 writer.exec('BEGIN IMMEDIATE');
 let ticks=0;const pulse=setInterval(()=>ticks++,25);const start=performance.now();
 try {await assert.rejects(shared.prepare("INSERT INTO items VALUES(4,'timeout')").run(),e=>(e.errcode&255)===5);}
 finally {clearInterval(pulse);writer.exec('ROLLBACK');}
 assert.ok(ticks>20,'bounded lock wait must keep event loop responsive');
 assert.ok(performance.now()-start<8000,'lock retry must remain bounded');
 assert.equal(await shared.prepare('SELECT * FROM items WHERE id=4').first(),null);
 console.log('SQLite lock contention: async retry, concurrent atomic writes and bounded wait passed');
} finally {writer.close();shared.close();rmSync(folder,{recursive:true,force:true});}
