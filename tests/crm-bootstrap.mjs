import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SnapshotReader} from '../lib/snapshot-reader.ts';

// The initial read must use the same cancellation/single-flight path as later snapshots.
const component=readFileSync('components/crm-app.tsx','utf8');
assert.match(component,/bootstrapReader\.current=new SnapshotReader\("\/api\/crm\?part=bootstrap"\)/);
assert.match(component,/const initial=await bootstrapReader\.current!\.read\(\);if\(!initial\)return false/);
assert.match(component,/bootstrapReader\.current\?\.invalidate\(\)/);
assert.match(component,/bootstrapReader\.current!\.invalidate\(\);\s+splitMode\.current=/,'Do not retain a second full initial snapshot after it is applied');
assert.doesNotMatch(component,/fetch\(['"]\/api\/crm\?part=bootstrap/);

for(const splitReads of [false,true]){
 let requests=0,finishBody;
 const initial={splitReads,personalAuth:true,currentEmployeeId:'synthetic-actor',orders:[],clients:[]};
 const reader=new SnapshotReader('/api/crm?part=bootstrap',async()=>{
  requests++;
  return {status:200,ok:true,headers:new Headers(),json:()=>new Promise(resolve=>finishBody=resolve)};
 });
 const pending=Array.from({length:20},()=>reader.read());
 await Promise.resolve();
 assert.equal(requests,1,'Mount, focus, online and periodic refreshes share the initial download');
 assert.ok(pending.every(p=>p===pending[0]));
 finishBody(initial);
 assert.ok((await Promise.all(pending)).every(value=>value===initial));
}
let attempts=0;
const retry=new SnapshotReader('/api/crm?part=bootstrap',async()=>++attempts===1?Response.json({error:'Temporary failure'},{status:503}):Response.json({recovered:true}));
await assert.rejects(retry.read(),{status:503});
assert.deepEqual(await retry.read(),{recovered:true});
console.log('Bootstrap: one request through slow body, both workspace modes, cleanup wiring and retry passed');
