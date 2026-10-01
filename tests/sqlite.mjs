import assert from 'node:assert/strict';
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
 console.log('SQLite: reads, writes and transaction rollback passed');
} finally { d.close(); }
