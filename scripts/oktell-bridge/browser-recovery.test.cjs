'use strict';
const assert=require('node:assert/strict'),http=require('node:http');
const {once}=require('node:events');
const {WebSocket,WebSocketServer}=require('ws');
const listen=async server=>{server.listen(0,'127.0.0.1');await once(server,'listening');return server.address().port;};
const waitFor=async predicate=>{for(let i=0;i<100;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,20));}throw Error('State did not settle');};
(async()=>{
 const upstream=new WebSocketServer({port:0,host:'127.0.0.1'});await once(upstream,'listening');
 const released=[];
 const bridge=require('./browser-phone.cjs')({listen:false,connected:()=>true,incoming:async()=>({id:'a'.repeat(32),status:'ringing'}),upstreamUrl:`ws://127.0.0.1:${upstream.address().port}`,operators:{validate(){},prepare:async()=>({username:'fixture',domain:'fixture.invalid'}),release:async(actor,owner)=>released.push(owner)}});
 const control=http.createServer(bridge.handle),controlPort=await listen(control),sipPort=await listen(bridge.server);
 const post=async(owner,action='connect')=>{const r=await fetch(`http://127.0.0.1:${controlPort}`,{method:'POST',body:JSON.stringify({actor:'fixture',owner,action})});return {status:r.status,data:await r.json()};};
 const state=async()=>await (await fetch(`http://127.0.0.1:${controlPort}/?actor=fixture`)).json();
 let client;
 try{
  const first=await post('a'.repeat(64));assert.equal(first.status,200);
  assert.equal((await post('b'.repeat(64))).status,409,'A live/pending owner must stay protected');
  const accepted=once(upstream,'connection');
  client=new WebSocket(`ws://127.0.0.1:${sipPort}/?token=${first.data.token}`,'sip',{origin:'https://crm.smanalytics.ru'});
  await once(client,'open');const [native]=await accepted;
  // No calls: simulate only an idle native transport failure.
  native.close();await waitFor(async()=>!(await state()).prepared);
  assert.deepEqual(released,['a'.repeat(64)]);
  assert.equal((await post('b'.repeat(64))).status,200,'A dead socket must not lock the next tab');
  assert.equal((await post('a'.repeat(64),'disconnect')).status,409,'Old tab cannot release the new owner');
  assert.equal((await state()).prepared,true);
  assert.equal((await post('b'.repeat(64),'disconnect')).status,200);
  const third=await post('c'.repeat(64));const next=once(upstream,'connection');
  client=new WebSocket(`ws://127.0.0.1:${sipPort}/?token=${third.data.token}`,'sip',{origin:'https://crm.smanalytics.ru'});
  await once(client,'open');const [activeNative]=await next;
  activeNative.send('INVITE sip:fixture@fixture.invalid SIP/2.0\r\nFrom: <sip:fixture@fixture.invalid>\r\nCall-ID: test-incoming\r\nCSeq: 1 INVITE\r\nContent-Length: 0\r\n\r\n');
  await waitFor(async()=>(await state()).calling);activeNative.close();
  await waitFor(async()=>!(await state()).calling);
  assert.equal((await state()).prepared,true,'Uncertain active call must not be automatically released');
  assert.equal((await post('d'.repeat(64))).status,409);
  console.log('Idle cleanup, active-call and live-owner protection passed');
 }finally{client?.terminate();await bridge.stop();control.close();upstream.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
