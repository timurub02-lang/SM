import assert from 'node:assert/strict';
import {openDatabase} from '../server/sqlite.ts';
import {runRedemptionDay,redemptionLeads} from '../lib/redemption-dispatch.ts';
const d=openDatabase(':memory:');
try{
 await d.batch(['CREATE TABLE settings(id TEXT PRIMARY KEY,data TEXT)','CREATE TABLE clients(id TEXT PRIMARY KEY,data TEXT)','CREATE TABLE employees(id TEXT PRIMARY KEY,data TEXT)','CREATE TABLE orders(id TEXT PRIMARY KEY,client_id TEXT,data TEXT)'].map(s=>d.prepare(s)));
 let network=0;const forbidden=async()=>{network++;throw Error('Unexpected external request');};
 await runRedemptionDay(d,new Date('2026-10-15T17:00:00Z'),forbidden);assert.equal(network,0);assert.equal((await d.prepare('SELECT state FROM redemption_dispatch').first()).state,'prepared');
 await d.prepare("INSERT INTO settings VALUES('redemption-config',?)").bind(JSON.stringify({automatic:true,projectId:''})).run();
 await runRedemptionDay(d,new Date('2026-10-16T17:00:00Z'),forbidden);assert.equal(network,0);
 const base={order_id:'o',entered_at:'2026-10-15T12:00:00Z',phone:'+79990000000',track:'123',clientName:'Test',comments:[],login:'op',status:'CREATED',total:100};
 assert.equal(redemptionLeads([{...base,testOnly:true}],'2026-10-16','https://crm.example').length,0);
 assert.equal(redemptionLeads([{...base,result:'delivered'}],'2026-10-16','https://crm.example').length,0);
 assert.equal(redemptionLeads([{...base,result:'date',resultDate:'2026-10-17'}],'2026-10-16','https://crm.example').length,0);
 assert.match(redemptionLeads([{...base,result:'date',resultDate:'2026-10-16'}],'2026-10-16','https://crm.example')[0].homepage,/redemption=o/);
 assert.equal(redemptionLeads([{...base,result:'to_return'}],'2026-10-16','https://crm.example').length,0);
 const retry={...base,action:'refusal',result:'date',resultDate:'2026-10-19',lastDay:'2026-10-15',refusalRetryUsed:true};assert.equal(redemptionLeads([retry],'2026-10-16','https://crm.example').length,0);assert.equal(redemptionLeads([retry],'2026-10-19','https://crm.example').length,1);
 const scheduled={...base,result:'date',resultDate:'2026-10-18',lastDay:'2026-10-15'};
 assert.equal(redemptionLeads([{...scheduled,dateConfirmation:'pending'}],'2026-10-18','https://crm.example').length,0);
 assert.equal(redemptionLeads([{...scheduled,dateConfirmation:'confirmed'}],'2026-10-15','https://crm.example').length,0);
 assert.equal(redemptionLeads([{...scheduled,dateConfirmation:'confirmed'}],'2026-10-17','https://crm.example').length,0);
 assert.equal(redemptionLeads([{...scheduled,dateConfirmation:'confirmed'}],'2026-10-18','https://crm.example').length,1);
 await d.prepare("UPDATE settings SET data=? WHERE id='redemption-config'").bind(JSON.stringify({automatic:true,projectId:'123'})).run();
 await d.prepare("INSERT INTO settings VALUES('skorozvon','{}')").run();
 let imported=[],posts=[];
 const fake=async(url,opts={})=>{let value;if(url.includes('/oauth/token'))value={access_token:'fake'};else if(url.includes('/call_projects'))value=[{id:123,state:'paused'}];else if(url.includes('leads?call_project_id'))value=imported;else if(url.endsWith('leads/import')){posts.push(JSON.parse(opts.body));imported=posts.at(-1).data.map((r,i)=>({...r,id:i+1}));value={id:1};}else if(url.includes('leads/import/'))value={state:'loaded'};else throw Error('Unexpected path '+url);return new Response(JSON.stringify(value),{status:200});};
 await d.prepare('INSERT INTO clients VALUES(?,?)').bind('c',JSON.stringify({id:'c',name:'Test',phone:base.phone})).run();
 await d.prepare('INSERT INTO orders VALUES(?,?,?)').bind('o','c',JSON.stringify({manager:'op',testTrack:'123',items:[]})).run();
 await d.prepare('INSERT INTO redemption_entries VALUES(?,?,?,1)').bind('o','2026-10-17T12:00:00Z','{}').run();
 await runRedemptionDay(d,new Date('2026-10-17T17:00:00Z'),fake,async()=>{});assert.equal(posts.length,1);assert.equal((await d.prepare("SELECT state FROM redemption_dispatch WHERE day='2026-10-18'").first()).state,'done');
 await runRedemptionDay(d,new Date('2026-10-17T17:05:00Z'),fake,async()=>{});assert.equal(posts.length,1);
 console.log('Dispatch: default zero network, empty project blocked, tests excluded, due date queue, mocked import verified and never repeated');
}finally{d.close();}

for(const scenario of ['success','shared','missing-phone']){
 const db=openDatabase(':memory:');
 try{
  await db.batch(['CREATE TABLE settings(id TEXT PRIMARY KEY,data TEXT)','CREATE TABLE clients(id TEXT PRIMARY KEY,data TEXT)','CREATE TABLE employees(id TEXT PRIMARY KEY,data TEXT)','CREATE TABLE orders(id TEXT PRIMARY KEY,client_id TEXT,data TEXT)'].map(s=>db.prepare(s)));
  await db.prepare('INSERT INTO settings VALUES(?,?)').bind('redemption-config',JSON.stringify({automatic:true,projectId:'123'})).run();
  await db.prepare("INSERT INTO settings VALUES('skorozvon','{}')").run();
  const old=Array.from({length:161},(_,i)=>({id:i+1,phones:i%2?[String(79990000000+i)]:String(79990000000+i)}));
  if(scenario==='missing-phone')old[0].phones=[];
  let deleted=false;const writes=[],searches=[];
  const fake=async(raw,opts={})=>{
   const url=new URL(raw);let value;
   if(url.pathname.endsWith('/oauth/token'))value={access_token:'fake'};
   else if(url.pathname.endsWith('/call_projects'))value=[{id:123,state:'paused'},{id:456,state:'active'}];
   else if(url.pathname.endsWith('/leads')){
    assert.equal(url.searchParams.get('order[column]'),'leads.id');assert.equal(url.searchParams.get('order[direction]'),'asc');
    if(url.searchParams.get('call_project_id')==='456'){
     const phones=url.searchParams.get('filter_phones');assert.ok(phones,'Never scan the whole other project');
     assert.ok(phones.split(',').length<=80);searches.push(phones);value=scenario==='shared'?[old[0]]:[];
    }else{const page=Number(url.searchParams.get('page'));value={data:deleted?[]:old.slice((page-1)*100,page*100),pagination:{total_pages:deleted?1:2}};}
   }else if(url.pathname.endsWith('/leads/bulk_deletes')){writes.push(JSON.parse(opts.body));deleted=true;value={id:9};}
   else if(url.pathname.endsWith('/bulk_deletes/9'))value={state:'finished'};
   else throw Error('Unexpected '+raw);
   return new Response(JSON.stringify(value));
  };
  await runRedemptionDay(db,new Date('2026-11-12T16:59:00Z'),fake,async()=>{});
  assert.equal(writes.length,0);assert.equal(searches.length,0);
  if(scenario==='success'){
   await runRedemptionDay(db,new Date('2026-11-12T17:00:00Z'),fake,async()=>{});
   assert.equal(writes.length,1);assert.equal(writes[0].ids.length,161);assert.deepEqual(searches.map(x=>x.split(',').length),[80,80,1]);
   const job=await db.prepare("SELECT * FROM redemption_dispatch WHERE day='2026-11-13'").first();
   assert.equal(job.state,'done');assert.equal(JSON.parse(job.data).oldContacts.length,161);
   await runRedemptionDay(db,new Date('2026-11-12T17:01:00Z'),fake,async()=>{});assert.equal(writes.length,1);
  }else{
   await assert.rejects(runRedemptionDay(db,new Date('2026-11-12T17:00:00Z'),fake,async()=>{}),scenario==='shared'?/общие контакты/:/нет телефона/);
   assert.equal(writes.length,0);assert.equal((await db.prepare("SELECT state FROM redemption_dispatch WHERE day='2026-11-13'").first()).state,'attention');
  }
 }finally{db.close()}
}
console.log('Fast dispatch: 20:00 Moscow, next day, 80-phone chunks, shared/missing-phone protections, backup and no repeat');
