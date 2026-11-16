import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDatabase} from '../server/sqlite.ts';
import {checkSkProjectMembership,skProjectClientMatches} from '../lib/sk-project-membership.ts';
import {syncSkOrders} from '../lib/sk-order-sync.ts';
import {acceptSkOrder} from '../lib/sk-order-import.ts';
const d=openDatabase(':memory:');
try{
 for(const sql of readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8').split('--> statement-breakpoint'))await d.prepare(sql).run();
 const target={callId:'100',leadId:'10',phone:'+79990000001',name:'Synthetic Client'};
 assert.equal(skProjectClientMatches({id:10,lead_phones:['+79990000001']},target),true);
 assert.equal(skProjectClientMatches({id:20,name:' synthetic  CLIENT ',phones:'89990000001'},target),true);
 assert.equal(skProjectClientMatches({id:20,name:'Other Person',phones:'89990000001'},target),false);
 assert.equal(skProjectClientMatches({id:10,phones:'89990000002'},target),false);
 let pages=[],fail=false;
 const api=async path=>{
  if(path.startsWith('/api/v2/call_projects?'))return [{id:123}];
  const page=Number(new URL('https://fixture.invalid'+path).searchParams.get('page'));pages.push(page);
  if(fail)throw Error('Provider unavailable');
  return {data:page===4?[{id:20,name:target.name,phones:target.phone}]:[],pagination:{page,total_pages:4}};
 };
 assert.equal((await checkSkProjectMembership(d,api,target,1000)).status,'pending');
 assert.deepEqual(pages,[1,2,3]);fail=true;
 await assert.rejects(checkSkProjectMembership(d,api,target,2000),/unavailable/);fail=false;pages=[];
 const found=await checkSkProjectMembership(d,api,target,3000);assert.equal(found.status,'found');assert.deepEqual(pages,[4]);assert.equal(found.membership.projectId,'123');assert.equal(found.membership.leadId,'20');
 assert.equal((await checkSkProjectMembership(d,async()=>({data:[],pagination:{page:1,total_pages:0}}),{...target,callId:'101'},4000)).status,'not-found');
 await assert.rejects(checkSkProjectMembership(d,async p=>p.includes('call_projects')?[{id:123}]:{data:[]},{...target,callId:'102'},5000),/не подтверждён/);
 const sender={id:'op',name:'Operator',login:'op',skLogin:'Operator',role:'operator',department:'1',version:1};
 await d.prepare('INSERT INTO employees(id,data) VALUES(?,?)').bind(sender.id,JSON.stringify(sender)).run();
 const input={...target,projectId:null,projectMembership:found.membership,email:'',userName:'Operator',userNameUnique:true,address:'',city:'',comment:''};
 const result=await acceptSkOrder(d,input);assert.equal(result.state,'imported');
 const order=JSON.parse((await d.prepare('SELECT data FROM orders WHERE id=?').bind(result.orderId).first()).data);assert.equal(order.skWithoutProject,false);assert.equal(order.skLeadId,'10');
 // A verified callback still cannot create a second active order or steal another operator's client.
 assert.equal((await acceptSkOrder(d,{...input,callId:'103'},undefined,'2030-01-01T00:00:00Z')).state,'pending');
 assert.match((await d.prepare("SELECT reason FROM sk_order_transfers WHERE id='103'").first()).reason,/действующие заказы/);
 await d.prepare("UPDATE clients SET data=json_set(data,'$.owner','other')").run();
 assert.equal((await acceptSkOrder(d,{...input,callId:'104'},undefined,'2030-01-01T01:00:00Z')).state,'pending');
 assert.match((await d.prepare("SELECT reason FROM sk_order_transfers WHERE id='104'").first()).reason,/другому оператору/);
 assert.doesNotMatch((await d.prepare("SELECT reason FROM sk_order_transfers WHERE id='104'").first()).reason,/не из Проекта/);
 // Exercise the actual report consumer: API evidence reaches the saved transfer and review path.
 const now=Date.parse('2026-11-16T10:00:00Z');
 for(const [id,value] of Object.entries({'skorozvon':{login:'fixture',apiKey:'fixture',clientId:'fixture',clientSecret:'fixture'},'sk-order-import':{enabled:true,enabledAt:'2026-11-16T09:00:00Z',resultIds:[123]}}))await d.prepare('INSERT INTO settings(id,data) VALUES(?,?)').bind(id,JSON.stringify(value)).run();
 const request=async(url,opts)=>{
  const u=new URL(url),p=u.pathname;
  if(p==='/oauth/token')return Response.json({access_token:'fixture'});
  if(p==='/api/v2/users')return Response.json([{id:7,name:'Operator'}]);
  if(p==='/api/reports/calls_total.json')return Response.json({data:[{id:500,scenario_result:{id:123}}],total_pages:1});
  if(p==='/api/v2/calls/500')return Response.json({id:500,lead_id:501,result_id:123,user_id:7,ended_at:'2026-11-16T09:30:00Z',phone:'+79990000500',direction:'out'});
  if(p==='/api/v2/leads/501')return Response.json({id:501,name:'Synthetic Callback',lead_phones:['+79990000500']});
  if(p==='/api/v2/call_projects')return Response.json([{id:123}]);
  if(p==='/api/v2/leads'){assert.equal(u.searchParams.get('call_project_id'),'123');return Response.json({data:[{id:501,lead_phones:['+79990000500']}],pagination:{page:1,total_pages:1}});}
  throw Error(p);
 };
 assert.equal((await syncSkOrders(d,request,now,async()=>{})).imported,1);
 const transfer=await d.prepare("SELECT data,state FROM sk_order_transfers WHERE id='500'").first();assert.equal(transfer.state,'imported');assert.equal(JSON.parse(transfer.data).projectId,null);assert.equal(JSON.parse(transfer.data).projectMembership.projectId,'123');
 console.log('SK project membership: bounded resumable checks, provider failure, phone/name identity, original lead, automatic callback import and conflict guards passed.');
}finally{d.close();}
