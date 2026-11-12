import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../server/sqlite.ts';
import {initCrmReadIndexes} from '../lib/crm-read-indexes.ts';
const d=openDatabase(':memory:');try{
 for(const sql of readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8').split('--> statement-breakpoint'))await d.prepare(sql).run();
 await initCrmReadIndexes(d);await initCrmReadIndexes(d);
 for(const [where,index] of [["client_id='synthetic'",'idx_events_client_time'],["order_id='synthetic'",'idx_events_order_time'],['1','idx_events_time']]){
  const plan=(await d.prepare('EXPLAIN QUERY PLAN SELECT data FROM events WHERE '+where+' ORDER BY at DESC,id DESC LIMIT 50').all()).results.map(r=>r.detail).join(' ');
  assert.ok(plan.includes(index),plan);assert.ok(!plan.includes('TEMP B-TREE'),plan);
 }
 console.log('History SQL uses bounded scope/time indexes without temporary sort');
}finally{d.close();}
