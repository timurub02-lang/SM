// Test-only upstream, injected into a standalone test server with --import.
import {readFileSync,writeFileSync} from 'node:fs';
const file=process.env.CDEK_TEST_FIXTURE;
if(!file)throw Error('CDEK_TEST_FIXTURE required');
const original=globalThis.fetch;
globalThis.fetch=async(input,options={})=>{
 const url=String(input instanceof Request?input.url:input);
 if(!url.startsWith('https://api.cdek.ru/v2/'))return original(input,options);
 const read=()=>JSON.parse(readFileSync(file,'utf8')),save=s=>writeFileSync(file,JSON.stringify(s));
 let state=read();const path=new URL(url).pathname,method=options.method||'GET';
 state.calls.push({path,method,body:options.body&&typeof options.body==='string'?JSON.parse(options.body):undefined});save(state);
 const response=(data,status=200)=>Response.json(data,{status});
 if(path.endsWith('/oauth/token'))return response({access_token:'synthetic-token'});
 if(method==='POST'&&path==='/v2/orders'){
  const payload=JSON.parse(options.body),uuid=crypto.randomUUID();state=read();
  state.orders[uuid]={number:payload.number,cdek_number:'NEW-'+state.calls.length,status:'CREATED',create:'SUCCESSFUL'};save(state);
  return response({entity:{uuid,cdek_number:state.orders[uuid].cdek_number},requests:[{type:'CREATE',state:'SUCCESSFUL'}]},202);
 }
 const uuid=path.split('/').at(-1);let order=state.orders[uuid];
 if(!order)return response({errors:[{message:'Unknown synthetic order'}]},404);
 if(method==='DELETE'){
  order.deletion=state.mode==='reject'?'INVALID':state.mode==='immediate'?'SUCCESSFUL':'ACCEPTED';order.deleteId=crypto.randomUUID();save(state);
  if(state.mode==='timeout')throw Error('Simulated upstream timeout');
  if(state.mode==='http400')return response({errors:[{message:'Warehouse movement'}]},400);
  return response({entity:{uuid},requests:[{type:'DELETE',state:order.deletion,request_uuid:order.deleteId,...(order.deletion==='INVALID'?{errors:[{message:'Warehouse movement'}]}:{})}]},202);
 }
 if(method==='GET'){
  if(state.getFailureUuid===uuid)return response({errors:[{message:'Temporary outage'}]},503);
  // Capture the response before waiting to reproduce an in-flight stale refresh.
  const data={entity:{uuid,number:order.number,cdek_number:order.cdek_number,statuses:[{code:order.status,date_time:'2026-10-05T08:00:00Z'}]},requests:[{type:'CREATE',state:order.create||'SUCCESSFUL'},...(order.deletion?[{type:'DELETE',state:order.deletion,request_uuid:order.deleteId,...(order.deletion==='INVALID'?{errors:[{message:'Warehouse movement'}]}:{})}]:[])]};
  if(state.delayNextGet){delete state.delayNextGet;save(state);await new Promise(r=>setTimeout(r,1200));}
  return response(data);
 }
 throw Error('Unexpected test upstream request '+method+' '+path);
};
