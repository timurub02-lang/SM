'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oktell-control-')),file=path.join(dir,'commands.sqlite');
let active=0,assigned=new Set(['719b7385-440d-4276-ba6c-ec9c5cf2e9b5','665e366c-7270-4010-8837-db877df38be3']),calls=0,unsafe=false,offline=false,uncertain=false;
const request=async(method,args)=>{
 if(method==='getmyuserinfo')return {isoperator:true,hasline:0,mainpbxnumber:''};
 if(method==='execpredefineddbstoredproc')return {result:1,dataset:[[['Id','Name','Active','Done','Type','IdProject','ListId'],['21d685d0-9cee-4af8-b2ea-dddde74e03a4','CRM NO CALLS 20261023',active,0,20,'656001e1-c652-4e1f-a8fc-20b7f30b5e41','00000000-0000-0000-0000-000000000000']],[['OperatorId','IsGroup'],...Array.from(assigned,x=>[x,0])],[['ExternalLines','SipLines','TaskLines','Lists','CallSessions','FailedCalls','MissedCalls'],[unsafe?1:0,0,0,0,0,0,0]]]};
 if(method.startsWith('cc_')){calls++;if(uncertain)throw Error('Response lost');if(method==='cc_settaskactive')active=Number(args.active);else if(method==='cc_addoperatortotask')assigned.add(args.operatorkey);else assigned.delete(args.operatorkey);}
 return {result:1};
};
const create=()=>require('./task-control.cjs')({request,connected:()=>!offline,enabled:()=>true,file});
(async()=>{try{
 let c=create();const cmd=async(action,operator,extra={})=>({id:crypto.randomUUID(),actor:'admin',action,...(operator?{operator}:{}),revision:(await c.read()).revision,...extra});
 const a=await cmd('activate');assert.equal((await c.command(a)).state.active,true);assert.equal(calls,1);assert.equal((await c.command(a)).replayed,true);assert.equal(calls,1);
 await assert.rejects(()=>c.command({...a,action:'deactivate'}),/уже использован/);
 await assert.rejects(()=>c.command({...a,id:crypto.randomUUID()}),/изменилось/);
 await assert.rejects(()=>c.command({...a,id:crypto.randomUUID(),taskkey:'foreign'}),/Недопустимая/);
 await assert.rejects(()=>c.command({...a,id:crypto.randomUUID(),action:'assign',operator:'03'}),/Недопустимая/);
 for(const operator of ['01','02']){assert.equal((await c.command(await cmd('remove',operator))).state.operators.find(x=>x.key===operator).assigned,false);assert.equal((await c.command(await cmd('assign',operator))).state.operators.find(x=>x.key===operator).assigned,true);}
 unsafe=true;
 const b=await cmd('activate');await assert.rejects(()=>c.command(b),/изоляции/);assert.equal((await c.command(await cmd('deactivate'))).state.active,false);unsafe=false;
 uncertain=true;const u=await cmd('activate');await assert.rejects(()=>c.command(u),/Response lost/);const count=calls;c=create();assert.equal((await c.command(u)).receipt.status,'unknown');assert.equal(calls,count);uncertain=false;
 offline=true;await assert.rejects(()=>c.read(),/Нет соединения/);
 console.log('PASS control: exact scope, state revision, two operators, confirmation, unsafe guard, safe stop, persistent dedupe, uncertain outcome, disconnect');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1});
