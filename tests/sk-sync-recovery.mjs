import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../server/sqlite.ts';
import {syncSkOrders} from '../lib/sk-order-sync.ts';

const now=Date.parse('2026-11-13T00:00:00Z'),previousSuccess=new Date(now-3600000).toISOString();
const review=[{callId:'8',leadId:'8',reason:'synthetic unresolved phone'}];
async function fixture(){
 const d=openDatabase(':memory:');
 for(const sql of readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8').split('--> statement-breakpoint'))await d.prepare(sql).run();
 for(const [id,data] of Object.entries({'skorozvon':{login:'fixture',apiKey:'fixture',clientId:'fixture',clientSecret:'fixture'},'sk-order-import':{enabled:true,enabledAt:new Date(now-7200000).toISOString(),resultIds:[123]},'sk-order-health':{ok:false,lastSuccessAt:previousSuccess,review}}))await d.prepare('INSERT INTO settings VALUES(?,?)').bind(id,JSON.stringify(data)).run();
 return d;
}
const health=async d=>JSON.parse((await d.prepare("SELECT data FROM settings WHERE id='sk-order-health'").first()).data);
const normal=url=>new URL(url).pathname==='/oauth/token'?Response.json({access_token:'fixture'}):new URL(url).pathname==='/api/v2/users'?Response.json([]):Response.json({data:[],total_pages:1});
for(const error of [new DOMException('secret timeout details','TimeoutError'),new TypeError('secret network details')]){
 const d=await fixture();let attempts=0;const signals=[];
 try{
  await syncSkOrders(d,async(url,init)=>{
   if(new URL(url).pathname==='/oauth/token'){signals.push(init.signal);assert.equal(init.signal.aborted,false);if(++attempts===1)throw error;}
   return normal(url);
  },now,async()=>{});
  assert.equal(attempts,2);assert.notEqual(signals[0],signals[1]);
  const h=await health(d);assert.equal(h.lastFailure.stage,'oauth');assert.equal(h.lastFailure.category,error.name==='TimeoutError'?'timeout':'network');assert.deepEqual(h.review,review);assert.equal(h.lastSuccessAt,new Date(now).toISOString());assert.ok(!JSON.stringify(h).includes('secret'));
  await syncSkOrders(d,normal,now,async()=>{});assert.deepEqual((await health(d)).lastFailure,h.lastFailure);
 }finally{d.close();}
}
for(const status of [502,503,504,401]){
 const d=await fixture();let attempts=0;
 try{
  await assert.rejects(syncSkOrders(d,async(url)=>{
   if(new URL(url).pathname==='/api/reports/calls_total.json'){attempts++;return new Response('secret upstream body',{status});}
   return normal(url);
  },now,async()=>{}));
  assert.equal(attempts,status===401?1:2);
  const h=await health(d);assert.equal(h.lastFailure.stage,'report');assert.equal(h.lastFailure.category,'http');assert.equal(h.lastFailure.status,status);assert.equal(h.lastSuccessAt,previousSuccess);assert.deepEqual(h.review,review);assert.ok(!JSON.stringify(h).includes('secret'));
  assert.equal((await d.prepare('SELECT report_until FROM sk_api_control WHERE id=1').first()).report_until,0);
 }finally{d.close();}
}
{
 const d=await fixture();let attempts=0;
 try{
  await syncSkOrders(d,async url=>new URL(url).pathname==='/api/reports/calls_total.json'&&++attempts===1?new Response('',{status:503}):normal(url),now,async()=>{});
  assert.equal(attempts,2);assert.equal((await health(d)).lastFailure.status,503);
  assert.equal((await d.prepare('SELECT report_until FROM sk_api_control WHERE id=1').first()).report_until,0);
 }finally{d.close();}
}
{
 const d=await fixture();let attempts=0;
 try{
  await assert.rejects(syncSkOrders(d,async()=>{attempts++;return new Response('secret',{status:429,headers:{'Retry-After':'120'}});},now,async()=>{}));
  assert.equal(attempts,1);const h=await health(d);assert.equal(h.lastFailure.status,429);assert.ok(Date.parse(h.retryAt)>=now+120000);assert.deepEqual(h.review,review);
  assert.equal((await syncSkOrders(d,async()=>assert.fail('cooldown bypass'),now+60000,async()=>{})).deferred,true);
 }finally{d.close();}
}
{
 const d=await fixture();let attempts=0;
 try{
  await assert.rejects(syncSkOrders(d,async url=>{
   if(new URL(url).pathname==='/api/reports/calls_total.json'){attempts++;throw new DOMException('secret body timeout','TimeoutError');}
   return normal(url);
  },now,async()=>{}));
  assert.equal(attempts,2);const h=await health(d);assert.equal(h.lastFailure.category,'timeout');assert.equal(h.lastSuccessAt,previousSuccess);assert.deepEqual(h.review,review);
  assert.equal((await d.prepare('SELECT report_until FROM sk_api_control WHERE id=1').first()).report_until,0);
 }finally{d.close();}
}
{
 const d=await fixture();let attempts=0;
 try{
  await assert.rejects(syncSkOrders(d,async()=>{attempts++;throw new DOMException('cancelled','AbortError');},now,async()=>{}));
  assert.equal(attempts,1);
 }finally{d.close();}
}
console.log('SK recovery: bounded retries, fresh signals, report lease, cooldown, review/watermark and safe retained diagnostics passed');
