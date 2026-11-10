import assert from 'node:assert/strict';
import {openDatabase} from '../server/sqlite.ts';
import {searchBaseClients} from '../lib/base-client-search.ts';
import {mayCallEndpoint} from '../lib/permissions.ts';
const d=openDatabase(':memory:');
for(const sql of ['CREATE TABLE clients(id TEXT PRIMARY KEY,data TEXT,version INTEGER)','CREATE TABLE employees(id TEXT PRIMARY KEY,data TEXT)','CREATE TABLE orders(id TEXT PRIMARY KEY,client_id TEXT,data TEXT)','CREATE TABLE client_phone_index(phone TEXT PRIMARY KEY,client_id TEXT)'])await d.prepare(sql).run();
await d.prepare('INSERT INTO employees VALUES(?,?)').bind('op',JSON.stringify({name:'Оператор'})).run();
for(const [id,name,baseType,owner] of [['one','Худяков Андрей Владимирович','M','op'],['two','Семёнов Андрей','J','']])await d.prepare('INSERT INTO clients VALUES(?,?,?)').bind(id,JSON.stringify({id,name,baseType,owner}),7).run();
await d.prepare("INSERT INTO orders VALUES('LV-66560','one','{}'),('SM-extra','one','{}')").run();
await d.prepare("INSERT INTO client_phone_index VALUES('79140622131','one'),('79991234567','two')").run();
for(const q of ['хУдЯкОв','LV-66560','66560','+7 (914) 062-21-31','89140622131']){
 const r=await searchBaseClients(d,q);assert.equal(r.matches.length,1,q);assert.equal(r.matches[0].client.id,'one');assert.equal(r.matches[0].client.version,7);assert.equal(r.matches[0].ownerName,'Оператор');
}
assert.equal((await searchBaseClients(d,'семенов')).matches[0].client.id,'two');
assert.equal((await searchBaseClients(d,'Андрей')).matches.length,2);
assert.equal((await searchBaseClients(d,"' OR 1=1 --")).matches.length,0);
await assert.rejects(searchBaseClients(d,'12'));
for(let i=0;i<31;i++)await d.prepare('INSERT INTO clients VALUES(?,?,1)').bind('extra'+i,JSON.stringify({name:'Тестовый'})).run();
const limited=await searchBaseClients(d,'тест');assert.equal(limited.matches.length,30);assert.equal(limited.more,true);
for(const role of ['operator','department_head','logistic','purchasing'])assert.equal(mayCallEndpoint({role},new URL('http://localhost/api/base-search'),'GET'),false);
assert.equal(mayCallEndpoint({role:'admin'},new URL('http://localhost/api/base-search'),'GET'),true);
d.close();console.log('Base search: names, Cyrillic/ё, phones, order IDs, both bases, limits, injection and role access passed');
