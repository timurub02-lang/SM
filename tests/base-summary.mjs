import assert from 'node:assert/strict';
import {openDatabase} from '../server/sqlite.ts';
import {normalizeBaseSheet} from '../lib/base-policy.ts';
import {baseCountsQuery,assignedCountsQuery,releasedTodayQuery,initBaseSummaryIndexes} from '../lib/base-summary.ts';
const d=openDatabase(':memory:');
try{
 await d.prepare('CREATE TABLE clients(id TEXT PRIMARY KEY,data TEXT NOT NULL)').run();
 await d.prepare("CREATE INDEX clients_base_sheet_owner ON clients(COALESCE(json_extract(data,'$.baseType'),'M'),json_extract(data,'$.sheet'),COALESCE(json_extract(data,'$.owner'),''))").run();
 const cases=[{}, {baseType:null,sheet:null,source:'import.xlsx · П'}, {baseType:'J',sheet:'П',source:'first'}, {baseType:'J',sheet:'П',source:'second',owner:'one'}, {baseType:'M',sheet:'',source:'import.xlsx · К',owner:'one'}, {baseType:'other',sheet:'ПВ',owner:'two'}, {baseType:'J',owner:'',releasedAt:'2026-11-11T21:01:00Z'}, {baseType:'J',owner:null,releasedAt:'2026-11-11T20:59:00Z'}, {owner:'one',releasedAt:'2026-11-12T00:00:00Z'}, {baseType:'M',sheet:'',source:'import.xlsx · Другая',owner:''}];
 cases.push({releasedAt:'now',owner:''},{releasedAt:'2026-11-11T22:00:00+03:00',owner:''},{releasedAt:'invalid',owner:''});
 for(let i=0;i<cases.length;i++)await d.prepare('INSERT INTO clients VALUES(?,?)').bind(String(i),JSON.stringify(cases[i])).run();
 for(const rowid of [-9223372036854775808n,0n,9223372036854775807n])await d.prepare('INSERT INTO clients(rowid,id,data) VALUES(?,?,?)').bind(rowid,'edge-'+rowid,JSON.stringify({baseType:'M',sheet:'',source:'edge.xlsx · '+rowid,owner:'one'})).run();
 const legacy=baseCountsQuery.replace(',CAST(MIN(rowid) AS TEXT) AS first_rowid','').replace(' WHERE length(data)>=0 GROUP BY',' GROUP BY');
 async function read(query=baseCountsQuery){
  const counts=(await d.prepare(query).all()).results;
  const summary={};for(const r of counts){const key=r.base+':'+normalizeBaseSheet(r.sheet||r.source.match(/\.xlsx · (.+)$/i)?.[1]||'');const old=summary[key]||{total:0,assigned:0};summary[key]={total:old.total+r.total,assigned:old.assigned+r.assigned};}
  return {summary,assigned:(await d.prepare(assignedCountsQuery).all()).results,released:(await d.prepare(releasedTodayQuery).bind('2026-11-12').all()).results};
 }
 const before=await read(legacy);await initBaseSummaryIndexes(d);await initBaseSummaryIndexes(d);assert.deepEqual(await read(),before);
 assert.deepEqual(await read(legacy),before,'Rollback must retain legacy source selection with new indexes still installed');
 assert.ok(!(await d.prepare('EXPLAIN QUERY PLAN '+legacy).all()).results.some(r=>r.detail.includes('idx_clients_base_summary')));
 for(const [query,values,index] of [[baseCountsQuery,[],'idx_clients_base_summary'],[assignedCountsQuery,[],'idx_clients_assigned_owner'],[releasedTodayQuery,['2026-11-12'],'idx_clients_release_time']]){
  const plan=(await d.prepare('EXPLAIN QUERY PLAN '+query).bind(...values).all()).results.map(r=>r.detail).join(' ');assert.ok(plan.includes(index),index+': '+plan);
  const ops=(await d.prepare('EXPLAIN '+query).bind(...values).all()).results;
  const loops=ops.filter(r=>r.opcode==='Next');
  assert.ok(!ops.some(r=>r.opcode==='Function'&&/json_extract|length\(/.test(String(r.p4))&&loops.some(loop=>r.addr>=loop.p2&&r.addr<loop.addr)), index+': aggregate loop must use stored index expressions');
 }
 // Indexes must stay correct for imports, reassignment, release and deletion too.
 await d.prepare("UPDATE clients SET data=json_set(data,'$.owner','two','$.sheet','Новый') WHERE id='0'").run();
 await d.prepare("UPDATE clients SET data=json_set(data,'$.owner','','$.releasedAt','2026-11-11T21:00:00Z') WHERE id='3'").run();
 await d.prepare("DELETE FROM clients WHERE id='6'").run();
 const indexed=await read();for(const name of ['idx_clients_base_summary','idx_clients_assigned_owner','idx_clients_release_time'])await d.prepare('DROP INDEX '+name).run();assert.deepEqual(await read(legacy),indexed);
 console.log('Base aggregates preserve sheet/source/owner/Moscow-date semantics and update with writes; index loops avoid client JSON parsing');
}finally{d.close();}
