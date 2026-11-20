import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {saveProjectDraft} from '../lib/oktell-project-store.ts';
import {newProjectSettings} from '../lib/oktell-project-settings.ts';
import {applyNativeProject,readNativeProject} from '../lib/oktell-project-apply.ts';
import {nativeSession} from '../lib/oktell-settings-native.ts';
import {nativeSettingsDiff,nativeFieldValue} from '../lib/oktell-settings-diff.ts';

const owner=randomUUID(),md5='A'.repeat(32),dir=mkdtempSync(join(tmpdir(),'native-settings-'));
const credentials=join(dir,'credentials.json');writeFileSync(credentials,JSON.stringify({login:'synthetic',password:'synthetic',userId:owner,helperMd5:md5}));
Object.assign(process.env,{OKTELL_PROJECT_SETTINGS:'1',OKTELL_SETTINGS_NATIVE:'lab-vm105',OKTELL_SETTINGS_CREDENTIALS:credentials});
const RealWebSocket=globalThis.WebSocket,sql=new DatabaseSync(':memory:');
const wrap=(query,args=[])=>({bind:(...values)=>wrap(query,values),first:async()=>sql.prepare(query).get(...args),all:async()=>({results:sql.prepare(query).all(...args)}),run:async()=>({meta:sql.prepare(query).run(...args)})});
const db={prepare:query=>wrap(query),batch:async statements=>{sql.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());sql.exec('COMMIT');return out;}catch(e){sql.exec('ROLLBACK');throw e;}}};
const projects=[],tasks=new Map(),operations=new Map(),methods=[];let lose='',wrongPin=false,wrongIdentity=false,mismatch=false;
class FakeSocket extends EventTarget{
 static OPEN=1;static CLOSED=3;readyState=0;
 constructor(url,protocol){super();assert.equal(url,'ws://10.21.103.2:4055');assert.equal(protocol,'json');queueMicrotask(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));});}
 close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
 send(raw){
  const [method,args]=JSON.parse(raw);methods.push(method);let reply={};
  if(method==='logout')return;
  if(method==='login'){assert.equal(args.usewebrtc,0);reply={result:1};}
  else if(method==='getmyuserinfo')reply={userid:wrongIdentity?randomUUID():owner,hasline:0};
  else if(method==='scriptdownload')reply={success:true,scriptname:'CRM ALE41 Refresh Tasks',files:[{name:'root.json',subdirectory:'',md5:wrongPin?'B'.repeat(32):md5}]};
  else if(method==='projectcreateempty'){reply={id:randomUUID()};projects.push({...reply,name:args.name});}
  else if(method==='policy_getviewedprojects')reply={objects:projects};
  else if(method==='startsvcscript'){
   assert.equal(args.scriptname,'CRM ALE41 Refresh Tasks');const b=JSON.parse(args.startparam1);let state=tasks.get(b.taskId);
   if(b.action==='read')reply={result:1,returnvalue:JSON.stringify(state)};
   else{
    if(operations.has(b.operationId)){assert.deepEqual(b,operations.get(b.operationId).body);state=operations.get(b.operationId).state;}
    else if((state?.snapshot||null)!==b.expected){reply={result:1,returnvalue:JSON.stringify({ok:false,code:51006})};}
    else{
     assert.deepEqual(Object.keys(b.settings).sort(),['maxLines','mode','name','ringSeconds','schedule','timezone']);
     state={...b.settings,ok:true,taskId:b.taskId,projectId:b.projectId,active:0,assignedLines:0,runtimeActivity:'0',snapshot:createHash('sha256').update(JSON.stringify(b.settings)).digest('hex').toUpperCase()};
     tasks.set(b.taskId,state);operations.set(b.operationId,{body:b,state});
    }
    if(!reply.result)reply={result:1,returnvalue:JSON.stringify(mismatch?{...state,ringSeconds:state.ringSeconds+1}:state)};
   }
  }else throw Error('Unexpected native command: '+method);
  if(lose===method){lose='';queueMicrotask(()=>this.close());return;}
  queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify([method+'result',{...reply,qid:args.qid}])})));
 }
}
globalThis.WebSocket=FakeSocket;
async function draft(){const id=randomUUID();await saveProjectDraft(db,'admin',{id,action:'create',settings:newProjectSettings('t1')});return id;}
const command=id=>({id,revision:1,action:'apply',expected:null});
try{
 const id=await draft();assert.equal((await readNativeProject(db,id)).state,null);
 const applied=await applyNativeProject(db,command(id));assert.equal(applied.state.active,0);assert.equal(applied.appliedRevision,1);assert.equal(projects.length,1);
 assert.equal((await readNativeProject(db,id)).state.taskId,id);
 await assert.rejects(applyNativeProject(db,command(id)),e=>e.status===409);assert.equal(projects.length,1);
 assert.equal((await readNativeProject(db,id)).pending,false);
 // Native committed but its response was lost. Persist the same operation across a new request.
 const lostId=await draft();lose='startsvcscript';await assert.rejects(applyNativeProject(db,command(lostId)),e=>e.status===503);
 const pending=sql.prepare('SELECT pending FROM oktell_project_native WHERE id=?').get(lostId).pending;assert.ok(pending);
 await assert.rejects(applyNativeProject(db,command(lostId)),e=>e.status===409);
 const recovered=await applyNativeProject(db,{...command(lostId),action:'retry'});assert.equal(recovered.state.taskId,lostId);assert.equal(recovered.pending,false);assert.equal(projects.length,2);
 assert.equal(operations.size,2);
 // Project create has no idempotency key: reconcile inventory, never blindly create twice.
 const createId=await draft();lose='projectcreateempty';await assert.rejects(applyNativeProject(db,command(createId)),e=>e.status===503);
 await applyNativeProject(db,{...command(createId),action:'retry'});assert.equal(projects.length,3);
 await applyNativeProject(db,command(createId));assert.equal(projects.length,3);
 const unknownId=await draft();await db.prepare('INSERT INTO oktell_project_native(id) VALUES(?)').bind(unknownId).run();
 await assert.rejects(applyNativeProject(db,{...command(unknownId),action:'retry'}),e=>e.status===409);assert.equal(projects.length,3);
 wrongPin=true;await assert.rejects(readNativeProject(db,id),e=>e.status===503);wrongPin=false;
 wrongIdentity=true;await assert.rejects(readNativeProject(db,id),e=>e.status===503);wrongIdentity=false;
 await assert.rejects(nativeSession(call=>call('cc_settaskactivity',{})),e=>e.status===403);
 assert.ok(!methods.includes('cc_settaskactivity'));assert.ok(!methods.includes('execpredefineddbstoredproc'));
 const desired=newProjectSettings('t1');
 assert.deepEqual(nativeSettingsDiff(desired,{...desired,schedule:[...desired.schedule].reverse()}),[]);
 assert.deepEqual(nativeSettingsDiff({...desired,maxAttempts:10},desired),[]);
 assert.deepEqual(nativeSettingsDiff({...desired,ringSeconds:51},desired),['ringSeconds']);
 assert.equal(nativeSettingsDiff(desired,null).length,5);
 assert.match(nativeFieldValue(desired,'schedule'),/Пн 07:00/);
 // A success-shaped reply with wrong values must retain the durable command, not claim applied.
 const mismatchId=await draft();mismatch=true;
 await assert.rejects(applyNativeProject(db,command(mismatchId)),e=>e.status===503&&e.message.includes('не совпали'));
 const uncertain=sql.prepare('SELECT pending,applied_revision FROM oktell_project_native WHERE id=?').get(mismatchId);
 assert.ok(uncertain.pending);assert.equal(uncertain.applied_revision,null);
 mismatch=false;
 const reconciled=await applyNativeProject(db,{...command(mismatchId),action:'retry'});
 assert.equal(reconciled.pending,false);assert.equal(reconciled.state.ringSeconds,50);
 process.env.OKTELL_SETTINGS_NATIVE='';const count=methods.length;await assert.rejects(nativeSession(()=>{}),e=>e.status===503);assert.equal(methods.length,count);
 console.log('PASS: isolated native contract, pinned helper/identity, durable lost-response recovery, no duplicate projects, CAS, disabled mode and no call commands');
}finally{globalThis.WebSocket=RealWebSocket;sql.close();rmSync(dir,{recursive:true,force:true});}
