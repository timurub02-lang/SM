import assert from 'node:assert/strict';
import {openDatabase} from '../server/sqlite.ts';
import {redemptionDayCounts} from '../lib/redemption-day-counts.ts';
const d=openDatabase(':memory:');
try{
 await d.batch(['CREATE TABLE redemption_history(id INTEGER PRIMARY KEY,order_id TEXT,at TEXT,data TEXT)','CREATE TABLE redemption_archives(day TEXT PRIMARY KEY,data TEXT)'].map(s=>d.prepare(s)));
 const admin={id:'a',role:'admin'},day='2026-10-16';
 const row=(id,v={})=>({order_id:id,entered_at:'2026-10-15T10:00:00Z',manager:'op',department:'1',...v});
 let rows=[row('morning'),row('moved',{result:'to_return',author:'Ivan',lastDay:day,updatedAt:'2026-10-16T08:00:00Z'}),row('old-return',{result:'to_return',updatedAt:'2026-10-15T10:00:00Z'})];
 await d.prepare('INSERT INTO redemption_history VALUES(1,?,?,?)').bind('moved','2026-10-15T10:00:00Z',JSON.stringify({result:'none',lastDay:'2026-10-15'})).run();
 await d.prepare('INSERT INTO redemption_history VALUES(2,?,?,?)').bind('moved','2026-10-16T08:00:00Z',JSON.stringify({changeKind:'action',result:'to_return',author:'Ivan',lastDay:day})).run();
 const get=(actor=admin)=>redemptionDayCounts(d,rows,actor,false,day);
 assert.deepEqual(await get(),{total:2,morning:2,added:0,withoutAuthor:1});
 rows[0]={...rows[0],result:'returned',author:'Maria',lastDay:day};
 rows.push(row('new',{entered_at:'2026-10-16T10:00:00Z'}));
 assert.deepEqual(await get(),{total:3,morning:2,added:1,withoutAuthor:1});
 rows[2]={...rows[2],result:'returned',returnVerifiedAt:'2026-10-16T10:01:00Z'};
 assert.deepEqual(await get(),{total:3,morning:2,added:1,withoutAuthor:1});
 assert.equal((await get({id:'h',role:'department_head',department:'1'})).total,3);
 assert.equal((await get({id:'h2',role:'department_head',department:'2'})).total,0);
 rows[3]={...rows[3],author:'Yesterday',lastDay:day};
 const next=await redemptionDayCounts(d,rows,admin,false,'2026-10-17');
 assert.equal(next.total,1);assert.equal(next.withoutAuthor,1);
 assert.equal(rows[3].author,'Yesterday','Historical source author is preserved');
 console.log('Daily cohort: morning, additions, moved/verified orders retained, current authors, scopes and next day passed');
}finally{d.close();}
