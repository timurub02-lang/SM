import assert from 'node:assert/strict';
import {openDatabase} from '../server/sqlite.ts';
import {searchBaseClients} from '../lib/base-client-search.ts';
import {mayCallEndpoint,authorizeCrm} from '../lib/permissions.ts';
const d=openDatabase(':memory:');
for(const sql of ['CREATE TABLE clients(id TEXT PRIMARY KEY,data TEXT,version INTEGER)','CREATE TABLE employees(id TEXT PRIMARY KEY,data TEXT)','CREATE TABLE orders(id TEXT PRIMARY KEY,client_id TEXT,data TEXT)','CREATE TABLE client_phone_index(phone TEXT PRIMARY KEY,client_id TEXT)'])await d.prepare(sql).run();
await d.prepare('INSERT INTO employees VALUES(?,?)').bind('op',JSON.stringify({id:'op',name:'Оператор',role:'operator',department:'SKP_'})).run();
for(const [id,name,baseType,owner] of [['one','Худяков Андрей Владимирович','M','op'],['two','Семёнов Андрей','J','']])await d.prepare('INSERT INTO clients VALUES(?,?,?)').bind(id,JSON.stringify({id,name,baseType,owner}),7).run();
await d.prepare("INSERT INTO orders VALUES('LV-66560','one','{}'),('SM-extra','one','{}')").run();
await d.prepare("INSERT INTO client_phone_index VALUES('79140622131','one'),('79991234567','two')").run();
for(const q of ['хУдЯкОв','LV-66560','66560','+7 (914) 062-21-31','89140622131']){
 const r=await searchBaseClients(d,q);assert.equal(r.matches.length,1,q);assert.equal(r.matches[0].client.id,'one');assert.equal(r.matches[0].client.version,7);assert.equal(r.matches[0].ownerName,'Оператор');
}
await d.prepare("UPDATE clients SET data=json_set(data,'$.legacyOrderHistory',json(?)) WHERE id='two'").bind(JSON.stringify([{externalId:'123456'}])).run();
for(const q of ['123456','LV-123456'])assert.equal((await searchBaseClients(d,q)).matches[0].client.id,'two');
assert.equal((await searchBaseClients(d,'семенов')).matches[0].client.id,'two');
assert.equal((await searchBaseClients(d,'Андрей')).matches.length,2);
assert.equal((await searchBaseClients(d,"' OR 1=1 --")).matches.length,0);
await assert.rejects(searchBaseClients(d,'12'));
for(let i=0;i<31;i++)await d.prepare('INSERT INTO clients VALUES(?,?,1)').bind('extra'+i,JSON.stringify({name:'Тестовый'})).run();
const limited=await searchBaseClients(d,'тест');assert.equal(limited.matches.length,30);assert.equal(limited.more,true);
for(const role of ['operator','courier','redemption','purchasing'])assert.equal(mayCallEndpoint({role},new URL('http://localhost/api/base-search'),'GET'),false);
assert.equal(mayCallEndpoint({role:'admin'},new URL('http://localhost/api/base-search'),'GET'),true);

for(const role of ['logistic','chief_logistic']){
 const viewer={id:role,role};
 assert.equal(mayCallEndpoint(viewer,new URL('http://localhost/api/base-search'),'GET'),true);
 assert.equal(mayCallEndpoint(viewer,new URL('http://localhost/api/base-search'),'POST'),false);
 const match=(await searchBaseClients(d,'Худяков',viewer)).matches[0];
 assert.equal(match.canOpen,true);assert.equal(match.ownerName,'Оператор');
}
const head={id:'head',role:'department_head',department:'SKP_'};
assert.equal(mayCallEndpoint(head,new URL('http://localhost/api/base-search'),'GET'),true);
assert.equal(mayCallEndpoint(head,new URL('http://localhost/api/base-search'),'POST'),false);
await d.prepare(`UPDATE clients SET data=json_set(data,'$.phone','79991234567','$.linkedPhones',json(?),'$.importFields',json(?),'$.biography','private note','$.address','private address')`).bind(JSON.stringify(["78888888888"]),JSON.stringify({Телефон:"77777777777"})).run();
const own=(await searchBaseClients(d,'Худяков',head)).matches[0];
assert.equal(own.canOpen,true);assert.equal(own.client.owner,'op');assert.equal(own.client.phone,'');assert.equal(own.client.linkedPhones,undefined);assert.equal(own.client.importFields,undefined);
const foreign=(await searchBaseClients(d,'Худяков',{...head,department:'M31_'})).matches[0];
assert.equal(foreign.canOpen,false);assert.equal(foreign.ownerName,'Оператор');assert.equal(foreign.client.address,'');assert.equal(foreign.client.biography,undefined);
const free=(await searchBaseClients(d,'семенов',head)).matches[0];assert.equal(free.canOpen,false);assert.equal(free.ownerName,'Не закреплён');assert.equal(free.client.legacyOrderHistory,undefined);
assert.equal((await searchBaseClients(d,'Худяков',{...head,department:''})).matches[0].canOpen,false);
for(const match of [own,foreign,free])for(const number of ['79991234567','78888888888','77777777777'])assert.ok(!JSON.stringify(match).includes(number));
const staff=[{id:'op',role:'operator',department:'SKP_'}];
for(const client of [{id:'foreign',owner:'other'},{id:'free',owner:''}])for(const action of ['updateClient','createOrder','requestOrder'])assert.throws(()=>authorizeCrm(head,{action,id:client.id,clientId:client.id},{clients:[client],employees:staff,orders:[]}));
assert.doesNotThrow(()=>authorizeCrm(head,{action:'updateClient',id:own.client.id},{clients:[own.client],employees:staff,orders:[]}));
d.close();console.log('Base search: names, Cyrillic/ё, phones, order IDs, both bases, limits, injection and role access passed');
