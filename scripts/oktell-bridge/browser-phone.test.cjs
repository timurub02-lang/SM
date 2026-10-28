'use strict';
const assert=require('node:assert/strict');
const {allowedSip}=require('./browser-phone.cjs');
const credentials={username:'test-phone',domain:'10.21.103.2'};
const make=(method,target='79990000001',id='a'.repeat(32),sipId='one')=>`${method} sip:${target}@10.21.103.2 SIP/2.0\r\nFrom: <sip:test-phone@10.21.103.2>;tag=x\r\nCall-ID: ${sipId}\r\nX-CRM-Call-ID: ${id}\r\nContent-Length: 0\r\n\r\n`;
assert.equal(allowedSip(make('INVITE'),credentials,null),false);
const grant={destination:'79990000001',callId:'a'.repeat(32),expires:Date.now()+30000};
assert.equal(allowedSip(make('INVITE'),credentials,grant),true);
assert.equal(allowedSip(make('INVITE','79990000002'),credentials,grant),false);
assert.equal(allowedSip(make('INVITE','79990000001','b'.repeat(32)),credentials,grant),false);
assert.equal(allowedSip(make('INVITE','79990000001','a'.repeat(32),'two'),credentials,grant),false);
assert.equal(allowedSip(make('REGISTER').replace('test-phone','other'),credentials,null),false);
assert.equal(allowedSip(make('REGISTER'),credentials,null),true);
assert.equal(allowedSip(make('MESSAGE'),credentials,null),false);
(async()=>{const calls=[];const operator=require('./operator-control.cjs')({actor:'E-43a21d76-351',identity:{userid:'00000000-0000-4000-8000-000000000001',userlogin:'test'},connected:()=>true,request:async(method,args)=>{calls.push({method,args});return method==='login'?{result:1,sipuser:'u',siplogin:'u',sippass:'secret'}:{result:1};}});
 const result=await operator.prepare('E-43a21d76-351','a'.repeat(64));assert.equal(result.username,'u');assert.equal(calls[0].args.usewebrtc,1);
 await assert.rejects(operator.prepare('E-43a21d76-351','b'.repeat(64)),/другой вкладке/);
 await assert.rejects(operator.prepare('other','a'.repeat(64)));
 await operator.release('E-43a21d76-351','b'.repeat(64));assert.equal(calls.length,1);
 await operator.release('E-43a21d76-351','a'.repeat(64));assert.equal(calls[1].method,'logout');assert.equal(calls.some(c=>/call|dial|invite/i.test(c.method)),false);
 console.log('Browser phone policy and operator lifecycle tests passed');})().catch(e=>{console.error(e);process.exit(1);});

const {normalizeResponseVia}=require('./browser-phone.cjs');
const response='SIP/2.0 401 Unauthorized\r\nVia: SIP/2.0/WSS browser.invalid:5060;branch=z9hG4bKabc;received=10.20.0.10;rport=4444\r\n';
const vias=new Map([['z9hG4bKabc','browser.invalid']]);
assert.equal(normalizeResponseVia(response,vias),response.replace('browser.invalid:5060','browser.invalid'));
assert.equal(normalizeResponseVia(response,new Map()),response);
assert.equal(normalizeResponseVia(response.replace('browser.invalid','foreign.invalid'),vias),response.replace('browser.invalid','foreign.invalid'));
assert.equal(normalizeResponseVia(response.replace(':5060',':5070'),vias),response.replace(':5060',':5070'));
assert.equal(normalizeResponseVia(response.replace('SIP/2.0 401 Unauthorized','REGISTER sip:x SIP/2.0'),vias),response.replace('SIP/2.0 401 Unauthorized','REGISTER sip:x SIP/2.0'));

const {normalizeRegisterContact}=require('./browser-phone.cjs');
const regResponse='SIP/2.0 200 OK\r\nVia: SIP/2.0/WSS browser.invalid;branch=z9hG4bKabc\r\nCSeq: 3 REGISTER\r\nContact: <sip:native@10.20.0.10:45000;transport=WS>\r\nExpires: 60\r\n\r\n';
const registrations=new Map([['z9hG4bKabc',{uri:'sip:random@browser.invalid;transport=ws',cseq:'3'}]]);
assert.match(normalizeRegisterContact(regResponse,registrations,'native'),/Contact: <sip:random@browser.invalid;transport=ws>;expires=60/);
assert.equal(normalizeRegisterContact(regResponse,registrations,'other'),regResponse);
assert.equal(normalizeRegisterContact(regResponse.replace('3 REGISTER','4 REGISTER'),registrations,'native'),regResponse.replace('3 REGISTER','4 REGISTER'));
assert.equal(normalizeRegisterContact(regResponse.replace('Expires: 60\r\n',''),registrations,'native'),regResponse.replace('Expires: 60\r\n',''));

assert.equal(allowedSip(make('INVITE')+make('INVITE','79990000002'),credentials,grant),false);
assert.equal(allowedSip(make('INVITE').replace('sip:79990000001@10.21.103.2','sip:79990000001@foreign.invalid'),credentials,grant),false);
assert.equal(allowedSip(make('INVITE').replace('Content-Length: 0','Content-Length: 1'),credentials,grant),false);

(async()=>{
 const commands=[];const operator=require('./operator-control.cjs')({actor:'E-43a21d76-351',identity:{userid:'00000000-0000-4000-8000-000000000001',userlogin:'test'},connected:()=>true,request:async(method,args)=>{commands.push(method);return method==='getmyuserinfo'?{isoperator:true,hasline:0}:method==='login'?{result:1,sipuser:'u',siplogin:'u',sippass:'fixture'}:{result:1};}});
 await assert.rejects(operator.command({actor:'E-43a21d76-351',action:'ready'}),/телефон/);
 await operator.prepare('E-43a21d76-351','a'.repeat(64));assert.deepEqual(commands,['login','getmyuserinfo','logout','login']);
 await operator.release('E-43a21d76-351','a'.repeat(64));
})().catch(e=>{console.error(e);process.exitCode=1;});

const otherGrant={destination:'79990000002',callId:'a'.repeat(32),expires:Date.now()+30000};
assert.equal(allowedSip(make('INVITE','79990000002'),credentials,otherGrant),true);
assert.equal(allowedSip(make('INVITE','79990000001'),credentials,otherGrant),false);
assert.equal(allowedSip(make('INVITE','79990000002'),credentials,{...otherGrant,expires:0}),false);
