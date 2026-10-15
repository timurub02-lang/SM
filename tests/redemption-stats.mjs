import assert from 'node:assert/strict';
import {openDatabase} from '../server/sqlite.ts';
import {redemptionStats} from '../lib/redemption-stats.ts';
const d=openDatabase(':memory:');
try{
 await d.batch(['CREATE TABLE employees(id TEXT PRIMARY KEY,data TEXT)','CREATE TABLE redemption_history(id INTEGER PRIMARY KEY,order_id TEXT,at TEXT,data TEXT)','CREATE TABLE redemption_archives(day TEXT PRIMARY KEY,at TEXT)'].map(s=>d.prepare(s)));
 for(const [id,name,role] of [['ivan','Иван','department_head'],['maria','Мария','department_head'],['op','Оператор','operator']])await d.prepare('INSERT INTO employees VALUES(?,?)').bind(id,JSON.stringify({name,role})).run();
 let id=0;
 async function event(order,author,action,at='2026-10-16T10:00:00Z',kind='action'){
  await d.prepare('INSERT INTO redemption_history VALUES(?,?,?,?)').bind(++id,order,at,JSON.stringify({authorId:author,action,changeKind:kind})).run();
 }
 const admin={id:'admin',role:'admin'},get=async(archive=false)=>Object.fromEntries((await redemptionStats(d,admin,'2026-10-16',archive)).map(s=>[s.id,s.count]));
 await event('one','ivan','date');await event('one','maria','work');assert.deepEqual(await get(),{ivan:1,maria:1});
 await event('one','ivan','work');await event('one','maria','date');assert.deepEqual(await get(),{ivan:1,maria:1});
 await event('two','ivan','nd');await event('two','maria','nd');assert.deepEqual(await get(),{ivan:2,maria:1});
 await event('two','maria','refusal');assert.deepEqual(await get(),{ivan:2,maria:2});
 await event('three','op','work');await event('three','maria','nd');assert.deepEqual(await get(),{ivan:2,maria:2});
 await event('comment','ivan','date',undefined,'comment');await event('confirm','ivan','date',undefined,'confirm_date');assert.deepEqual(await get(),{ivan:2,maria:2});
 await event('old','ivan','date','2026-10-15T20:59:00Z');await event('midnight','ivan','date','2026-10-15T21:00:00Z');assert.deepEqual(await get(),{ivan:3,maria:2});
 await d.prepare('INSERT INTO redemption_archives VALUES(?,?)').bind('2026-10-16','2026-10-16T16:50:00Z').run();
 await event('late','maria','work','2026-10-16T17:00:00Z');assert.deepEqual(await get(true),{ivan:3,maria:2});assert.deepEqual(await get(),{ivan:3,maria:3});
 assert.deepEqual(await redemptionStats(d,{id:'ivan',role:'department_head'},'2026-10-16'),[{id:'ivan',name:'Иван',count:3}]);
 assert.deepEqual(await redemptionStats(d,{id:'op',role:'operator'},'2026-10-16'),[]);
 console.log('Stats passed: independent authors, unique orders, first ND, overwrites, Moscow day, archive cutoff, role visibility');
}finally{d.close();}
