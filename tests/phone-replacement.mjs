import assert from 'node:assert/strict';
import {openDatabase} from '../server/sqlite.ts';
import {initReplacement,replacementPhone,replacementRoute,replacementDecision} from '../lib/phone-replacement.ts';
const d=openDatabase(':memory:');
try{
 await d.batch(['CREATE TABLE settings(id TEXT PRIMARY KEY,data TEXT)','CREATE TABLE clients(id TEXT PRIMARY KEY,phone TEXT,data TEXT)','CREATE TABLE orders(id TEXT PRIMARY KEY,client_id TEXT,data TEXT,version INTEGER)'].map(s=>d.prepare(s)));
 await initReplacement(d);
 const config={enabled:true,threshold:500,enable:{crm:['shipping'],cdek:['DELIVERED']},disable:{crm:['packing'],cdek:[]},release:{crm:['refused'],cdek:['REMOVED']}};
 await d.prepare("UPDATE settings SET data=? WHERE id='phone-replacement'").bind(JSON.stringify(config)).run();
 const ns=['79000000001','79000000002'];for(const n of ns)await d.prepare('INSERT INTO replacement_numbers(number,added_at) VALUES(?,?)').bind(n,'2026-01-01').run();
 await d.prepare("INSERT INTO settings VALUES('phone-replacement-health',?)").bind(JSON.stringify({at:new Date().toISOString(),numbers:ns})).run();
 await d.prepare('INSERT INTO clients VALUES(?,?,?)').bind('c','79990000000',JSON.stringify({name:'Test'})).run();
 const order={id:'o',clientId:'c',version:0,status:'packing'};
 await d.prepare('INSERT INTO orders VALUES(?,?,?,0)').bind('o','c',JSON.stringify(order)).run();
 const allocated=await Promise.all([replacementPhone(d,order,'+79990000000'),replacementPhone(d,order,'+79990000000')]);assert.equal(allocated[0].phone,allocated[1].phone);assert.equal((await d.prepare('SELECT SUM(uses) n FROM replacement_numbers').first()).n,1);
 assert.equal((await replacementRoute(d,allocated[0].phone)).mode,'wait');
 await d.prepare('UPDATE orders SET data=? WHERE id=?').bind(JSON.stringify({...order,status:'shipping'}),'o').run();assert.equal((await replacementRoute(d,allocated[0].phone)).destination,'79990000000');
 await d.prepare('UPDATE clients SET phone=?').bind('79990000003').run();assert.equal((await replacementRoute(d,allocated[0].phone)).destination,'79990000003');
 await d.prepare('UPDATE orders SET data=? WHERE id=?').bind(JSON.stringify({...order,status:'refused',cdekStatus:{code:'DELIVERED'}}),'o').run();assert.equal((await replacementRoute(d,allocated[0].phone)).mode,'free');
 await d.prepare('UPDATE orders SET data=? WHERE id=?').bind(JSON.stringify(order),'o').run();assert.equal((await replacementPhone(d,order,'+79990000003')).phone,'+'+ns[1]);
 assert.equal((await d.prepare('SELECT COUNT(*) n FROM replacement_assignments').first()).n,2);
 assert.equal(replacementDecision(config,{status:'packing',cdekStatus:{code:'DELIVERED'}}),'disable');
 await d.prepare("UPDATE settings SET data='{}' WHERE id='phone-replacement-health'").run();await assert.rejects(replacementPhone(d,order,'+79990000003'),/недоступен/);
 console.log('Masking: atomic allocation, retry, fairness, status priority, history and dynamic main phone passed.');
}finally{d.close();}
