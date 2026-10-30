 'use strict';
const assert=require('node:assert/strict'),{randomUUID:uuid}=require('node:crypto');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const make=require('./pilot-control.cjs');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'callback-owner-')),file=path.join(dir,'pilot.sqlite');
const user=uuid(),other=uuid(),task=uuid(),actor='E-test';
const config={listId:uuid(),taskId:task,operators:[{actor,userid:user}],contacts:[1,2,3].map(n=>({phone:'7999000000'+n,clientId:'C-'+n})),results:['Перезвон','Отказ']};
const requests=[],sent=[];let ack='fail',release,blockedCommand;
const options={file,callbackRouting:true,load:()=>config,identity:()=>({userid:config.operators[0].userid}),connected:()=>true,
 send:(m,a)=>sent.push([m,a]),request:async(m,a)=>{requests.push([m,a]);if(a.inputparams.command===blockedCommand)throw Error('unmatched old result');if(ack==='wait')await new Promise(r=>release=r);if(ack==='fail')throw Error('offline');return {result:1,dataset:[[['CommandId'],[ack==='wrong'?uuid():a.inputparams.command]]]};}};
let p=make(options);
const emit=(m,a)=>p.event(m,{qid:uuid(),userid:config.operators[0].userid,...a});
async function finish(callback=true){
 const chain=uuid(),form=uuid();
 emit('phoneevent_ringstarted',{istask:true,taskid:task,chainid:chain,callerid:config.contacts[0].phone});
 await p.incoming(actor,config.contacts[0].phone,uuid());
 emit('phoneevent_commstarted',{istask:true,taskid:task,chainid:chain,callerid:config.contacts[0].phone});
 emit('phoneevent_commstopped',{chainid:chain});emit('dlgcard_showformstop',{idshow:form});
 const result={id:uuid(),chain,outcome:callback?'Перезвон':'Отказ',comment:'fixture',...(callback?{callbackAt:new Date(Date.now()+3600000).toISOString()}:{})};
 assert.throws(()=>p.result(actor,{...result,operatorUserId:other}));
 p.result(actor,result);return {result,form};
}
(async()=>{
 const first=await finish();await p.syncCallbacks();assert.equal(requests.length,0,'unconfirmed is not routable');
 emit('dlgcard_closeall',{idshow:first.form});
 await assert.rejects(p.syncCallbacks,/offline/);
 ack='wrong';await assert.rejects(p.syncCallbacks,/подтверждена/);
 p.close();config.operators[0].userid=other;p=make(options);ack='wait';
 const sync=p.syncCallbacks();await p.syncCallbacks();assert.equal(requests.length,3,'one in-flight sync only');release();await sync;
 assert.equal(requests[2][0],'execpredefineddbstoredproc');assert.equal(requests[2][1].procedure,'w_crm_t1_callback_sync');
 assert.deepEqual(requests[2][1].inputparams,{command:first.result.id,chain:first.result.chain,task,list:config.listId,operator:user,phone:config.contacts[0].phone,due:first.result.callbackAt});
 p.close();p=make(options);await p.syncCallbacks();assert.equal(requests.length,3,'durable receipt prevents replay');
 const final=await finish(false);emit('dlgcard_closeall',{idshow:final.form});ack='ok';await p.syncCallbacks();assert.equal(requests[3][1].inputparams.due,null,'terminal result clears affinity');
 await finish();p.close();p=make(options);await p.syncCallbacks();assert.equal(requests.length,4,'unknown after restart stays blocked');
 p.close();
 const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(file);
 const row=db.prepare('SELECT * FROM pilot_calls WHERE command_id=?').get(first.result.id);
 const goodCommand=uuid();blockedCommand=uuid();
 for(const command of [blockedCommand,goodCommand])db.prepare(`INSERT INTO pilot_calls(chain,actor,phone,client_id,started_at,status,result,command_id,command_state,updated_at)
 VALUES(?,?,?,?,?,'completed',?,?,'confirmed',?)`).run(uuid(),actor,row.phone,row.client_id,row.started_at,row.result,command,row.updated_at);
 db.close();p=make(options);await assert.rejects(p.syncCallbacks,/unmatched/);assert.equal(requests.length,6);
 await assert.rejects(p.syncCallbacks,/unmatched/);assert.equal(requests.length,7,'bad result does not prevent other receipt');
 p.close();p=make({...options,callbackRouting:false});await p.syncCallbacks();assert.equal(requests.length,7);
 assert.equal(sent.filter(([m])=>m==='dlgcard_setstopformresult').length,3);
 assert.ok(sent.every(([m])=>['dlgcard_setstopformresult','dlgcard_showformdone'].includes(m)));
 p.close();fs.rmSync(dir,{recursive:true,force:true});console.log('PASS: callback identity, confirmation, retries, exact receipts, restart, terminal result, no dial commands');
})().catch(e=>{console.error(e);process.exitCode=1;});
