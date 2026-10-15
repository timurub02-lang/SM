import assert from 'node:assert/strict';
import {openDatabase} from '../server/sqlite.ts';
import {initReplacement,replacementPhone,replacementRoute,replacementDecision} from '../lib/phone-replacement.ts';
const d=openDatabase(':memory:');
try{
 await d.batch(['CREATE TABLE settings(id TEXT PRIMARY KEY,data TEXT)','CREATE TABLE clients(id TEXT PRIMARY KEY,phone TEXT,data TEXT)','CREATE TABLE orders(id TEXT PRIMARY KEY,client_id TEXT,data TEXT,version INTEGER)'].map(s=>d.prepare(s)));
 await initReplacement(d);
 const config={enabled:true,threshold:500,enable:{crm:['shipping'],cdek:['DELIVERED']},release:{crm:['refused'],cdek:['REMOVED']}};
 await d.prepare("UPDATE settings SET data=? WHERE id='phone-replacement'").bind(JSON.stringify(config)).run();
 const ns=['79000000001','79000000002'];for(const n of ns)await d.prepare('INSERT INTO replacement_numbers(number,added_at) VALUES(?,?)').bind(n,'2026-01-01').run();
 await d.prepare("INSERT INTO settings VALUES('phone-replacement-health',?)").bind(JSON.stringify({at:new Date().toISOString(),numbers:ns})).run();
 await d.prepare('INSERT INTO clients VALUES(?,?,?)').bind('c','79990000000',JSON.stringify({name:'Test'})).run();
 const order={id:'o',clientId:'c',version:0,status:'packing'};
 await d.prepare('INSERT INTO orders VALUES(?,?,?,0)').bind('o','c',JSON.stringify(order)).run();
 const allocated=await Promise.all([replacementPhone(d,order,'+79990000000'),replacementPhone(d,order,'+79990000000')]);assert.equal(allocated[0].phone,allocated[1].phone);assert.equal((await d.prepare('SELECT SUM(uses) n FROM replacement_numbers').first()).n,1);
 assert.equal((await replacementRoute(d,allocated[0].phone)).mode,'wait');
 await d.prepare('UPDATE orders SET data=? WHERE id=?').bind(JSON.stringify({...order,status:'shipping'}),'o').run();assert.equal((await replacementRoute(d,allocated[0].phone)).destination,'79990000000');
 // Returning clients must never be routed to themselves, and additional numbers count as the client.
 assert.equal((await replacementRoute(d,allocated[0].phone,'79990000000')).mode,'wait');
 await d.prepare('UPDATE clients SET data=?').bind(JSON.stringify({name:'Test',linkedPhones:['+79990000004']})).run();
 assert.equal((await replacementRoute(d,allocated[0].phone,'+79854172919')).destination,'79990000000');
 assert.equal((await replacementRoute(d,allocated[0].phone,'+79990000000')).destination,'79854172919');
 assert.equal((await replacementRoute(d,allocated[0].phone,'+79990000004')).destination,'79854172919');
 await replacementRoute(d,allocated[0].phone,'+79990000005');
 assert.equal((await replacementRoute(d,allocated[0].phone,'+79990000000')).destination,'79990000005');
 // A checkbox save changes both directions immediately without touching the order.
 await d.prepare("UPDATE settings SET data=? WHERE id='phone-replacement'").bind(JSON.stringify({...config,enable:{crm:[],cdek:[]}})).run();
 for(const caller of ['79990000000','79990000006'])assert.equal((await replacementRoute(d,allocated[0].phone,caller)).mode,'wait');
 assert.equal((await d.prepare('SELECT phone FROM replacement_callbacks').first()).phone,'79990000005');
 await d.prepare("UPDATE settings SET data=? WHERE id='phone-replacement'").bind(JSON.stringify(config)).run();
 assert.equal((await replacementRoute(d,allocated[0].phone,'79990000000')).destination,'79990000005');
 await d.prepare('UPDATE orders SET data=? WHERE id=?').bind(JSON.stringify({...order,status:'check'}),'o').run();
 assert.equal((await replacementRoute(d,allocated[0].phone,'79990000000')).mode,'wait');
 await d.prepare('UPDATE orders SET data=? WHERE id=?').bind(JSON.stringify({...order,status:'shipping'}),'o').run();
 await d.prepare('UPDATE clients SET phone=?').bind('79990000003').run();assert.equal((await replacementRoute(d,allocated[0].phone)).destination,'79990000003');
 await d.prepare('UPDATE orders SET data=? WHERE id=?').bind(JSON.stringify({...order,status:'refused',cdekStatus:{code:'DELIVERED'}}),'o').run();assert.equal((await replacementRoute(d,allocated[0].phone)).mode,'free');assert.equal((await d.prepare('SELECT COUNT(*) n FROM replacement_callbacks').first()).n,0);
 await d.prepare('UPDATE orders SET data=? WHERE id=?').bind(JSON.stringify(order),'o').run();assert.equal((await replacementPhone(d,order,'+79990000003')).phone,'+'+ns[1]);
 assert.equal((await d.prepare('SELECT COUNT(*) n FROM replacement_assignments').first()).n,2);
 assert.equal(replacementDecision(config,{status:'packing',cdekStatus:{code:'DELIVERED'}}),'enable');
// Reusing the old B creates a fresh assignment with no old courier.
 await d.prepare("INSERT INTO orders VALUES('o2','c',?,0)").bind(JSON.stringify({...order,id:'o2',status:'shipping'})).run();
 const reused=await replacementPhone(d,{...order,id:'o2',status:'shipping'},'+79990000003');assert.equal(reused.phone,allocated[0].phone);
 assert.equal((await replacementRoute(d,reused.phone,'79990000003')).mode,'wait');
 await d.prepare("UPDATE settings SET data='{}' WHERE id='phone-replacement-health'").run();await assert.rejects(replacementPhone(d,order,'+79990000003'),/недоступен/);
 console.log('Masking: atomic allocation, retry, fairness, status priority, history and dynamic main phone passed.');
}finally{d.close();}
