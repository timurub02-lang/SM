'use strict';
const assert=require('node:assert/strict'),make=require('./operator-control.cjs');
const actor='E-test',identity={userid:'00000000-0000-4000-8000-000000000001',userlogin:'test'};
function fixture({hasline=1,isoperator=true,apply=true}={}){
 const calls=[];let state={userstateid:1,oncallcenter:false,onlunch:false};
 const operator=make({actor,identity,connected:()=>true,request:async(method,args)=>{
  calls.push(method);
  if(method==='login')return {result:1};
  if(method==='getmyuserinfo')return {hasline,isoperator};
  if(method==='checkuserintask')return {intask:false};
  if(method==='setuserstate'){if(apply)state={...args};return {result:1};}
  if(method==='getuserstate')return state;
  throw Error(method);
 }});return {operator,calls};
}
(async()=>{
 const idle=fixture();assert.equal((await idle.operator.command({actor,action:'ready'})).state,'ready');
 assert.equal(idle.calls.includes('setuserstate'),true);
 const refused=fixture({apply:false});await assert.rejects(refused.operator.command({actor,action:'ready'}),/не применил/);
 for(const options of [{hasline:0},{isoperator:false}]){
  const bad=fixture(options);await assert.rejects(bad.operator.command({actor,action:'ready'}));assert.equal(bad.calls.includes('setuserstate'),false);
 }
 const foreign=fixture();await assert.rejects(foreign.operator.command({actor:'E-other',action:'ready'}));assert.equal(foreign.calls.length,0);
 console.log('PASS: idle operator can enter; native refusal, identity, role and phone guards preserved');
})().catch(e=>{console.error(e);process.exitCode=1;});
