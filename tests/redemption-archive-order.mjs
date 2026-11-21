import assert from 'node:assert/strict';
import {openDatabase} from '../server/sqlite.ts';
import {archiveOrderDays} from '../lib/redemption-archive.ts';
const db=openDatabase(':memory:');
try{
 await db.prepare('CREATE TABLE redemption_archives(day TEXT PRIMARY KEY,data TEXT)').run();
 const row={order_id:'LV-123456',manager:'own',phone:'private',result:'date',resultDate:'2026-11-24',author:'Мария',action:'work',
  comments:[{text:'Вчера',at:'2026-11-20T20:59:00Z'},{text:'Сегодня',at:'2026-11-20T21:00:00Z'}]};
 for(const [day,rows] of [['2026-11-20',[{...row,action:'nd',result:'none'}]],['2026-11-21',[row,{...row,order_id:'SM-SK-123456',manager:'other'},{...row,order_id:'LV-1123456'}]]])
  await db.prepare('INSERT INTO redemption_archives VALUES(?,?)').bind(day,JSON.stringify(rows)).run();
 const admin={role:'admin'},own={id:'own',role:'operator'};
 const days=await archiveOrderDays(db,own,'123456');
 assert.deepEqual(days.map(d=>[d.day,d.orderId,d.action,d.result,d.author,d.comments.map(c=>c.text)]),[
  ['2026-11-21','LV-123456','В работе','24.11.2026','Мария',['Сегодня']],['2026-11-20','LV-123456','1НД','1НД','Мария',['Вчера']]]);
 assert.ok(!JSON.stringify(days).includes('private'));
 assert.equal((await archiveOrderDays(db,admin,'123456')).length,3);
 assert.deepEqual(await archiveOrderDays(db,admin,'lv-123456'),days);
 assert.deepEqual(await archiveOrderDays(db,own,'3456'),[]);
 await assert.rejects(archiveOrderDays(db,admin,'%'));
}finally{db.close();}
