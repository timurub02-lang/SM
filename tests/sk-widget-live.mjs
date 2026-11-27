import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import http from 'node:http';
import {testCard,createCallTracker,mountPhone,sdkUrl} from '../prototypes/skorozvon/live-model.mjs';
import {createLiveServer} from '../prototypes/skorozvon/serve-live.mjs';
assert.equal(new URL(sdkUrl).origin,'https://widget.skorozvon.ru');
assert.throws(()=>testCard({externalId:'',name:'Test'}));
assert.throws(()=>testCard({externalId:'x',name:'x'.repeat(201)}));
assert.deepEqual(testCard({externalId:' 123 ',name:' Test ',city:' '}),{externalId:'123',name:'Test',city:''});
const call=(id,external)=>({id,get:k=>k==='lead_external_id'?external:undefined});
const track=createCallTracker(),a=call('a',123),b=call('b',null);
assert.equal(track('call:ringing',a).externalId,'123');
assert.deepEqual(track('call:started',b),{overlap:true});
assert.equal(track('call:connected',a).active,true);
assert.equal(track('call:ended',a).active,false);
assert.equal(track('call:connected',a),null);
assert.equal(track('call:started',b).externalId,null);
assert.equal(track('call:ended',a),null);
assert.equal(track('unknown',b),null);
assert.equal(track('call:ended',{}),null);
assert.equal(track('call:ended',b).active,false);
let options,shown=0;const calls=[],statuses=[];
class Phone extends EventEmitter{constructor(value){super();options=value;this.phoneModel=new EventEmitter();}show(){shown++;}}
const widget=mountPhone({Widgets:{Phone}},(...v)=>calls.push(v),s=>statuses.push(s));
assert.equal(options.waitActiveCall,true);assert.equal(options.disallowNormalStateOnActiveCall,true);assert.equal(shown,1);
assert.equal(options.canClose,false);
widget.phoneModel.emit('call:connected',a);assert.deepEqual(calls,[['call:connected',a]]);
for(const name of ['authorized','ready','unauthorized'])widget.emit(name);
assert.deepEqual(statuses,['authorized','ready','unauthorized']);
// No login, automatic dialing or CRM write method is available on this stub.
const server=createLiveServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
try{
  const base=`http://127.0.0.1:${server.address().port}`;
  const page=await fetch(base);assert.equal(page.status,200);
  assert.match(page.headers.get('permissions-policy'),/microphone=\(self\)/);
  assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.match(page.headers.get('content-security-policy'),/https:\/\/widget\.skorozvon\.ru/);
  assert.equal(page.headers.get('cache-control'),'no-store');
  const html=await page.text();assert.match(html,/Тестовая карточка/);assert.doesNotMatch(html,/type="password"/);
  assert.match(html,/<button id="dial-test"[^>]*disabled/);
  assert.match(page.headers.get('content-security-policy'),/connect-src 'self'/);
  assert.deepEqual(await (await fetch(base+'/test-call')).json(),{configured:false,claimed:false});
  const claimHeaders={'Origin':base,'X-Test-Call':'1'};
  assert.equal((await fetch(base+'/test-call',{method:'POST',headers:claimHeaders})).status,409);
  for(const path of ['/live.mjs','/live-model.mjs','/live.css','/style.css'])assert.equal((await fetch(base+path)).status,200);
  assert.equal((await fetch(base+'/?api_host=https://example.org')).status,400);
  assert.equal((await fetch(base+'/.env')).status,404);
  assert.equal((await fetch(base,{method:'POST',body:'secret'})).status,405);
  const rejectedHost=await new Promise((resolve,reject)=>http.get(base,{headers:{Host:'attacker.example'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject));
  assert.equal(rejectedHost,403);
  assert.equal((await fetch(base,{method:'HEAD'})).status,200);
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
assert.throws(()=>createLiveServer('not-a-phone'));
const testNumber='+70000000000',configuredServer=createLiveServer(testNumber);
await new Promise(resolve=>configuredServer.listen(0,'127.0.0.1',resolve));
try{
  const base=`http://127.0.0.1:${configuredServer.address().port}`;
  const claim=(origin,extra={})=>fetch(base+'/test-call',{method:'POST',headers:{Origin:origin,...extra}});
  assert.deepEqual(await (await fetch(base+'/test-call')).json(),{configured:true,claimed:false});
  assert.equal((await fetch(base)).status,200);
  assert.equal((await claim('https://example.org',{'X-Test-Call':'1'})).status,403);
  assert.equal((await claim(base)).status,403);
  const attempts=await Promise.all([claim(base,{'X-Test-Call':'1'}),claim(base,{'X-Test-Call':'1'})]);
  assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409]);
  assert.deepEqual(await attempts.find(r=>r.ok).json(),{number:testNumber});
  assert.deepEqual(await (await fetch(base+'/test-call')).json(),{configured:true,claimed:true});
}finally{configuredServer.closeAllConnections();await new Promise(r=>configuredServer.close(r));}
console.log('Real widget adapter and loopback server checks passed (synthetic SDK; no login or calls).');
