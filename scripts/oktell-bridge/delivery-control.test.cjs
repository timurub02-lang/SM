'use strict';
const assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const make=require('./delivery-control.cjs');
const taskId=randomUUID(),listId=randomUUID(),taskListId=randomUUID(),calls=[];let online=true,badReceipt=false;
const dataset=row=>({result:1,dataset:[[Object.keys(row),Object.values(row)]]});
const receipts=new Map();
const control=make({load:()=>({taskId}),connected:()=>online,request:async(method,args)=>{
 assert.equal(method,'execpredefineddbstoredproc');assert.equal(args.inputparams.task,taskId);calls.push(args.procedure);
 if(args.procedure==='w_crm_delivery_state')return dataset({TaskId:taskId,TaskName:'Synthetic T1',ListId:listId,TaskListId:taskListId,Active:0,Done:0,SourcePresent:1,Contacts:0,Sessions:0});
 const p=args.inputparams;
 if(args.procedure==='w_crm_delivery_import'){if(!receipts.has(p.batch))receipts.set(p.batch,{BatchId:p.batch,TaskId:taskId,Fingerprint:p.fingerprint,Accepted:JSON.parse(p.payload).length,Cancelled:0});}
 else{assert.equal(args.procedure,'w_crm_delivery_cancel');receipts.get(p.batch).Cancelled=1;}
 return dataset({...receipts.get(p.batch),...(badReceipt?{BatchId:randomUUID()}:{} )});
}});
(async()=>{
 const state=await control.state();assert.equal(state.sourceAttached,false);assert.equal(state.paused,true);
 const batch={taskId,id:randomUUID(),fingerprint:'a'.repeat(64),items:[{clientId:'C-synthetic',phone:'79990000001',name:'Synthetic'}]};
 assert.equal((await control.importBatch(batch)).accepted,1);await control.importBatch(batch);assert.equal(receipts.size,1);
 const before=calls.length;
 for(const body of [{...batch,taskId:randomUUID()},{...batch,items:[]},{...batch,items:[...batch.items,...batch.items]},{...batch,items:[{...batch.items[0],phone:79990000001}]},{...batch,items:[{...batch.items[0],sql:'arbitrary'}]}])await assert.rejects(()=>control.importBatch(body));
 assert.equal(calls.length,before);
 badReceipt=true;await assert.rejects(()=>control.importBatch(batch),/соответствует/);badReceipt=false;
 assert.equal((await control.cancel({taskId,id:batch.id})).cancelled,true);assert.equal((await control.importBatch(batch)).cancelled,true);
 online=false;await assert.rejects(()=>control.state(),/связи/);
 assert.ok(calls.every(p=>['w_crm_delivery_state','w_crm_delivery_import','w_crm_delivery_cancel'].includes(p)));
 console.log('PASS: bounded source API, task binding, receipt identity, duplicate rejection, cancellation and disconnect; no dialing commands');
})().catch(e=>{console.error(e);process.exitCode=1;});
