'use strict';
const assert=require('node:assert/strict'),http=require('node:http');
const {once}=require('node:events');
const {WebSocket,WebSocketServer}=require('ws');
const createOperators=require('./linked-operators.cjs'),createPhone=require('./browser-phone.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const links=Object.fromEntries(Array.from({length:100},(_,i)=>['E-'+i,{userid:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,userlogin:'test'+i}]));
const requests=[],sockets=[];let gate=null;
const operators=createOperators({load:()=>links,connected:()=>true,request:async(method,args)=>{
 requests.push({method,...args});if(gate&&args.userlogin==='test0')await gate;
 return method==='login'?{result:1,sipuser:args.userlogin,siplogin:args.userlogin,sippass:'synthetic-only',sipdomain:'example.invalid'}:{result:1};
}});
const upstream=new WebSocketServer({port:0,host:'127.0.0.1'});
upstream.on('connection',ws=>ws.on('message',raw=>{const text=raw.toString();if(text.startsWith('REGISTER '))ws.send('SIP/2.0 200 OK\r\nCSeq: 1 REGISTER\r\nContact: <sip:test@example.invalid>;expires=300\r\nContent-Length: 0\r\n\r\n');}));
let phone,control;
(async()=>{try{
 await once(upstream,'listening');
 phone=createPhone({operators,connected:()=>true,listen:false,upstreamUrl:'ws://127.0.0.1:'+upstream.address().port});
 phone.server.listen(0,'127.0.0.1');await once(phone.server,'listening');
 control=http.createServer(phone.handle);control.listen(0,'127.0.0.1');await once(control,'listening');
 const base='http://127.0.0.1:'+control.address().port;
 const owner=i=>i.toString(16).padStart(64,'0');
 async function command(i,action,extra={}){const r=await fetch(base,{method:'POST',body:JSON.stringify({actor:'E-'+i,owner:owner(i),action,...extra})});return {status:r.status,data:await r.json()};}
 async function state(i){const r=await fetch(base+'?actor=E-'+i);return {status:r.status,data:await r.json()};}
 assert.deepEqual(phone.deploymentState(),{busy:false});
 const results=await Promise.all(Array.from({length:100},(_,i)=>command(i,'connect')));
 assert.ok(results.every(r=>r.status===200));assert.equal(operators.activeUsers().length,100);
 assert.equal(new Set(results.map(r=>r.data.token)).size,100);
 assert.equal((await state(0)).data.password,undefined);
 assert.equal((await state(0)).data.token,undefined);
 assert.deepEqual(results.map(r=>r.data.username),Array.from({length:100},(_,i)=>'test'+i));
 assert.equal((await command(0,'connect')).status,409);
 assert.equal((await command(0,'disconnect',{owner:owner(1)})).status,409);
 assert.equal((await command(101,'connect')).status,403);
 assert.equal((await state(101)).status,403);
 async function socket(token){const ws=new WebSocket('ws://127.0.0.1:'+phone.server.address().port+'/?token='+token,'sip',{origin:'https://crm.smanalytics.ru'});sockets.push(ws);await once(ws,'open');return ws;}
 await Promise.all(results.map(async(r,i)=>{
  const ws=await socket(r.data.token),reply=once(ws,'message');
  ws.send(`REGISTER sip:example.invalid SIP/2.0\r\nFrom: <sip:test${i}@example.invalid>;tag=x\r\nContent-Length: 0\r\n\r\n`);await reply;
 }));
 assert.ok((await Promise.all(results.map((_,i)=>state(i)))).every(r=>r.data.registered));
 const calls=await Promise.all(results.map((_,i)=>command(i,'authorize',{destination:'79990000001',callId:i.toString(16).padStart(32,'0')})));
 assert.ok(calls.every(r=>r.status===200));assert.deepEqual(phone.deploymentState(),{busy:true});
 // A grant belonging to another operator cannot authorize this phone's INVITE.
 const first=sockets[0],closed=once(first,'close');
 first.send('INVITE sip:79990000001@example.invalid SIP/2.0\r\nFrom: <sip:test0@example.invalid>;tag=x\r\nCall-ID: isolated\r\nX-CRM-Call-ID: '+(1).toString(16).padStart(32,'0')+'\r\nContent-Length: 0\r\n\r\n');await closed;
 assert.equal((await state(1)).data.registered,true);
 assert.equal((await command(0,'disconnect')).status,200);
 assert.equal((await state(0)).data.prepared,false);
 assert.equal((await state(1)).data.prepared,true);
 assert.equal(operators.activeUsers().length,99);
 // Rebinding is refused while the old identity is active, but logout still works.
 links['E-1']={userid:'00000000-0000-4000-8000-000000000101',userlogin:'replacement'};
 assert.equal((await command(1,'heartbeat')).status,409);
 assert.equal((await command(1,'disconnect')).status,200);
 assert.equal((await command(1,'connect')).data.username,'replacement');
 links['E-102']={...links['E-2']};assert.equal((await command(102,'connect')).status,403);delete links['E-102'];
 delete links['E-2'];assert.deepEqual(phone.deploymentState(),{busy:true});assert.equal((await command(2,'heartbeat')).status,403);assert.equal((await command(2,'disconnect')).status,200);
 // Disconnect during an outstanding login cannot resurrect a browser lease.
 let unblock;gate=new Promise(r=>unblock=r);
 const connecting=command(0,'connect');while(!requests.some(r=>r.method==='login'&&r.userlogin==='test0'&&requests.indexOf(r)>100))await delay(5);
 assert.deepEqual(phone.deploymentState(),{busy:true});
 operators.disconnected();phone.disconnected();unblock();gate=null;
 assert.equal((await connecting).status,503);assert.equal((await state(0)).data.prepared,false);
 assert.equal(operators.activeUsers().length,0);assert.deepEqual(phone.deploymentState(),{busy:false});
 assert.equal((await command(0,'connect')).status,200);
 // Expiration cleans up one lease while a later lease stays registered independently.
 const realNow=Date.now;
 try{Date.now=()=>realNow()+100000;assert.equal((await command(1,'connect')).status,200);
  for(let n=0;n<120&&(await state(0)).data.prepared;n++)await delay(100);
  assert.equal((await state(0)).data.prepared,false);assert.equal((await state(1)).data.prepared,true);
 }finally{Date.now=realNow;}
 assert.equal(requests.some(r=>/call|dial|invite/i.test(r.method)),false);
 console.log('PASS: 100 isolated operator logins, WebSockets, registrations and grants; ownership, mapping changes, revocation and disconnect race. No real PBX or calls.');
}finally{
 for(const ws of sockets)ws.terminate();
 for(const ws of upstream.clients)ws.terminate();
 if(phone)await phone.stop();if(control)await new Promise(r=>control.close(r));await new Promise(r=>upstream.close(r));
}})().catch(e=>{console.error(e);process.exitCode=1;});
