import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {gzipSync} from 'node:zlib';
import {proxyLegacySnapshot,legacySnapshotRequest} from '../lib/crm-legacy-proxy.ts';

const url='http://127.0.0.1:39999/api/crm?transport=compact-v1';
const actor={id:'synthetic-admin',role:'admin'};
const request=(suffix='',options={})=>new Request(url+suffix,options);
const envNames=['CRM_RUNTIME','CRM_LEGACY_SNAPSHOT_ORIGIN','CRM_LEGACY_SNAPSHOT_WORKER','CRM_LEGACY_SNAPSHOT_TIMEOUT_MS'];
const saved=Object.fromEntries(envNames.map(key=>[key,process.env[key]]));
let server,received=[],mode='full';
try{
 process.env.CRM_RUNTIME='miran';delete process.env.CRM_LEGACY_SNAPSHOT_ORIGIN;delete process.env.CRM_LEGACY_SNAPSHOT_WORKER;
 assert.equal(await proxyLegacySnapshot(request(),actor,()=>assert.fail('default off')),null);
 server=createServer((req,res)=>{
  received.push({url:req.url,headers:req.headers,method:req.method});
  if(mode==='slow')return;
  if(mode==='stream'){res.writeHead(200,{'Content-Type':'application/json'});res.write('{"orders":[');return;}
  if(mode==='redirect'){res.writeHead(302,{Location:'http://192.0.2.1/must-not-follow'});res.end();return;}
  if(mode==='304'){res.writeHead(304,{ETag:'W/"synthetic-v1"',Vary:'Cookie, Accept-Encoding'});res.end();return;}
  res.setHeader('ETag','W/"synthetic-v2"');res.setHeader('Vary','Cookie, Accept-Encoding');res.setHeader('Content-Type','application/json');
  const body=JSON.stringify({kind:mode==='delta'?'crm-delta':'full',orders:[{id:'o1',premiumStage:{status:'paid'}}]});
  if(mode==='gzip'){const zipped=gzipSync(body);res.setHeader('Content-Encoding','gzip');res.setHeader('Content-Length',zipped.length);res.end(zipped);return;}
  res.write(body.slice(0,12));setImmediate(()=>res.end(body.slice(12)));
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 process.env.CRM_LEGACY_SNAPSHOT_ORIGIN=`http://127.0.0.1:${server.address().port}`;
 for(const role of ['operator','department_head','purchasing'])assert.equal(await proxyLegacySnapshot(request(),{...actor,role}),null);
 for(const candidate of [request('',{method:'POST',body:'{}'}),request('&part=context'),request('&list=orders'),request('&transport=compact-v1'),request('&actorId=other'),request('&next=1')])assert.equal(await proxyLegacySnapshot(candidate,actor),null);
 assert.equal(legacySnapshotRequest(new Request(url.replace('/api/crm?','/api/crm/changes?'))),false);
 assert.equal(received.length,0);
 for(const role of ['admin','logistic','chief_logistic','redemption','courier']){
  const response=await proxyLegacySnapshot(request('&actorId='+actor.id,{headers:{Cookie:'__Host-sm-session=synthetic-only','If-None-Match':'W/"synthetic-v1"','Accept-Encoding':'br','Authorization':'must-not-forward','oai-authenticated-user-id':'must-not-forward'}}),{...actor,role});
  assert.equal(response.status,200);assert.equal((await response.json()).orders[0].premiumStage.status,'paid');
  const last=received.at(-1);assert.equal(last.method,'GET');assert.equal(last.headers.cookie,'__Host-sm-session=synthetic-only');assert.equal(last.headers['if-none-match'],'W/"synthetic-v1"');assert.equal(last.headers['accept-encoding'],'identity');assert.equal(last.headers.authorization,undefined);assert.equal(last.headers['oai-authenticated-user-id'],undefined);
 }
 mode='304';let response=await proxyLegacySnapshot(request(),actor);assert.equal(response.status,304);assert.equal(await response.text(),'');assert.equal(response.headers.get('etag'),'W/"synthetic-v1"');
 mode='delta';response=await proxyLegacySnapshot(request(),actor);assert.equal((await response.json()).kind,'crm-delta');
 mode='gzip';response=await proxyLegacySnapshot(request(),actor);assert.equal(response.headers.has('content-encoding'),false);assert.equal(response.headers.has('content-length'),false);assert.equal((await response.json()).orders[0].id,'o1');
 mode='redirect';response=await proxyLegacySnapshot(request(),actor);assert.equal(response.status,503);
 const origin=process.env.CRM_LEGACY_SNAPSHOT_ORIGIN;
 for(const invalid of ['http://localhost:3101','http://127.1:3101','http://2130706433:3101','https://127.0.0.1:3101','http://127.0.0.1:3101/','http://user@127.0.0.1:3101','http://127.0.0.1:99999',new URL(url).origin]){
  process.env.CRM_LEGACY_SNAPSHOT_ORIGIN=invalid;assert.equal((await proxyLegacySnapshot(request(),actor,()=>assert.fail('invalid target'))).status,503);
 }
 process.env.CRM_LEGACY_SNAPSHOT_ORIGIN=origin;process.env.CRM_LEGACY_SNAPSHOT_WORKER='1';
 assert.equal(await proxyLegacySnapshot(request(),actor,()=>assert.fail('worker recursion')),null);
 for(const employee of [undefined,{...actor,role:'operator'},{...actor,role:'purchasing'}])assert.equal((await proxyLegacySnapshot(request(),employee)).status,403);
 assert.equal((await proxyLegacySnapshot(request('&actorId=other'),actor)).status,403);
 delete process.env.CRM_LEGACY_SNAPSHOT_WORKER;mode='slow';process.env.CRM_LEGACY_SNAPSHOT_TIMEOUT_MS='100';
 assert.equal((await proxyLegacySnapshot(request(),actor)).status,503,'timeout must not fall back to main computation');
 const abort=new AbortController();abort.abort();assert.equal((await proxyLegacySnapshot(request('',{signal:abort.signal}),actor)).status,503);
 mode='stream';response=await proxyLegacySnapshot(request(),actor);assert.equal(response.status,200);await assert.rejects(()=>response.text(),'deadline still applies after headers');
 process.env.CRM_LEGACY_SNAPSHOT_TIMEOUT_MS='30000';const active=new AbortController();response=await proxyLegacySnapshot(request('',{signal:active.signal}),actor);active.abort();await assert.rejects(()=>response.text(),'client abort cancels streaming body');
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));server=undefined;
 assert.equal((await proxyLegacySnapshot(request(),actor)).status,503,'worker down must not fall back');
 console.log('PASS legacy snapshot proxy: default-off, role/route isolation, transport, compression, redirects, timeout and worker failure');
}finally{
 if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 for(const key of envNames){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
}
