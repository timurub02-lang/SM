import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../server/sqlite.ts';
import {checkSkProjectMembership} from '../lib/sk-project-membership.ts';
import {syncSkOrders} from '../lib/sk-order-sync.ts';
import {acceptSkOrder,initSkOrders} from '../lib/sk-order-import.ts';
import {initBaseDispatch} from '../lib/base-dispatch.ts';
import {initialBaseSettings} from '../lib/base-policy.ts';
const d=openDatabase(':memory:');
try{
 for(const sql of readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8').split('--> statement-breakpoint'))await d.prepare(sql).run();
 const target={callId:'100',leadId:'10',phone:'+79990000001',name:'Synthetic Client'};
 await initSkOrders(d);await initBaseDispatch(d);
 const config=initialBaseSettings();config.M.sheets.find(s=>s.name==='Т1').projectId='123';
 const save=()=>d.prepare("INSERT INTO settings(id,data) VALUES('base-settings',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify({config})).run();await save();
 async function dispatch(id,phone,project,state='sent',sheet='Т1'){
  await d.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)').bind(id,phone,JSON.stringify({id,phone,name:id,owner:'',baseType:'M',sheet})).run();
  await d.prepare('INSERT INTO base_dispatch_jobs(id,base,sheet,project,distribution_date,created_at) VALUES(?,?,?,?,?,?)').bind(id,'M',sheet,project,'2026-11-01','2026-11-01T00:00:00Z').run();
  await d.prepare('INSERT INTO base_dispatch_items(job_id,client_id,state,updated_at) VALUES(?,?,?,?)').bind(id,id,state,'2026-11-01T00:00:00Z').run();
 }
 await dispatch('known',target.phone,'123');
 const found=await checkSkProjectMembership(d,target,3000);assert.equal(found.status,'found');assert.equal(found.membership.jobId,'known');
 // A new project invalidates the old cycle immediately, including on its first day.
 config.M.sheets.find(s=>s.name==='Т1').projectId='456';await save();
 assert.equal((await checkSkProjectMembership(d,target,4000)).status,'not-found');
 config.M.sheets.find(s=>s.name==='Т1').projectId='123';await save();
 for(const state of ['pending','sending','unknown','failed']){
  const phone='+7999000000'+({pending:2,sending:3,unknown:4,failed:5}[state]);await dispatch(state,phone,'123',state);
  assert.equal((await checkSkProjectMembership(d,{...target,phone},5000)).status,'not-found');
 }
 assert.equal((await checkSkProjectMembership(d,{...target,phone:'+79990000999'},5000)).status,'not-found');
 const sender={id:'op',name:'Operator',login:'op',skLogin:'Operator',role:'operator',department:'1',version:1};
 await d.prepare('INSERT INTO employees(id,data) VALUES(?,?)').bind(sender.id,JSON.stringify(sender)).run();
 const input={...target,projectId:null,dispatchVerified:true,projectMembership:found.membership,email:'',userName:'Operator',userNameUnique:true,address:'',city:'',comment:''};
 const result=await acceptSkOrder(d,input);assert.equal(result.state,'imported');
 const order=JSON.parse((await d.prepare('SELECT data FROM orders WHERE id=?').bind(result.orderId).first()).data);assert.equal(order.skWithoutProject,false);assert.equal(order.skLeadId,'10');
 // A verified callback still cannot create a second active order or steal another operator's client.
 assert.equal((await acceptSkOrder(d,{...input,callId:'103'},undefined,'2030-01-01T00:00:00Z')).state,'pending');
 assert.match((await d.prepare("SELECT reason FROM sk_order_transfers WHERE id='103'").first()).reason,/действующие заказы/);
 await d.prepare("UPDATE clients SET data=json_set(data,'$.owner','other') WHERE id='known'").run();
 assert.equal((await acceptSkOrder(d,{...input,callId:'104'},undefined,'2030-01-01T01:00:00Z')).state,'pending');
 assert.match((await d.prepare("SELECT reason FROM sk_order_transfers WHERE id='104'").first()).reason,/другому оператору/);
 assert.doesNotMatch((await d.prepare("SELECT reason FROM sk_order_transfers WHERE id='104'").first()).reason,/не из Проекта/);
 // The report consumer must not enumerate SK projects or their clients.
 await dispatch('callback','+79990000500','123');
 const now=Date.parse('2026-11-16T10:00:00Z');
 for(const [id,value] of Object.entries({'skorozvon':{login:'fixture',apiKey:'fixture',clientId:'fixture',clientSecret:'fixture'},'sk-order-import':{enabled:true,enabledAt:'2026-11-16T09:00:00Z',resultIds:[123]}}))await d.prepare('INSERT INTO settings(id,data) VALUES(?,?)').bind(id,JSON.stringify(value)).run();
 const request=async(url,opts)=>{
  const u=new URL(url),p=u.pathname;
  if(p==='/oauth/token')return Response.json({access_token:'fixture'});
  if(p==='/api/v2/users')return Response.json([{id:7,name:'Operator'}]);
  if(p==='/api/reports/calls_total.json')return Response.json({data:[{id:500,scenario_result:{id:123}}],total_pages:1});
  if(p==='/api/v2/calls/500')return Response.json({id:500,lead_id:501,result_id:123,user_id:7,ended_at:'2026-11-16T09:30:00Z',phone:'+79990000500',direction:'out'});
  if(p==='/api/v2/leads/501')return Response.json({id:501,name:'Synthetic Callback',lead_phones:['+79990000500']});
  throw Error(p);
 };
 assert.equal((await syncSkOrders(d,request,now,async()=>{})).imported,1);
 const transfer=await d.prepare("SELECT data,state FROM sk_order_transfers WHERE id='500'").first();assert.equal(transfer.state,'imported');assert.equal(JSON.parse(transfer.data).projectId,null);assert.equal(JSON.parse(transfer.data).projectMembership.projectId,'123');
 assert.equal(JSON.parse(transfer.data).dispatchVerified,true);
 const denied=await acceptSkOrder(d,{...input,callId:'600',phone:'+79990000600',projectId:'123',dispatchVerified:false,projectMembership:undefined});
 assert.equal(denied.state,'pending');assert.match(denied.reason,/Создан не из Проекта/);
 assert.equal(await d.prepare("SELECT id FROM orders WHERE json_extract(data,'$.skLeadId')='600'").first(),null);
 console.log('Local successful dispatch, cycle rotation, failed/pending exclusion, report without project API, and ownership/active-order guards passed.');
}finally{d.close();}
