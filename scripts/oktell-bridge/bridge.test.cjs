'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{WebSocket}=require('ws');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'oktell-bridge-test-')),sock=path.join(dir,'control.sock'),config=path.join(dir,'config.json');
const login='test',password='test-only-not-a-real-secret',auth='Basic '+Buffer.from(login+':'+password).toString('base64');
const identity={userlogin:'crm_test_01',userid:'719b7385-440d-4276-ba6c-ec9c5cf2e9b5'},task='21d685d0-9cee-4af8-b2ea-dddde74e03a4';
let child,peer;let seen=[];
function control(body,url=body?'/query':'/status'){return new Promise((resolve,reject)=>{const req=http.request({socketPath:sock,path:url,method:body?'POST':'GET'},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(raw)}));});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});}
async function start(writes){fs.writeFileSync(config,JSON.stringify({login,password,commissioningWrites:writes}));child=spawn(process.execPath,[path.join(__dirname,'bridge.cjs')],{env:{...process.env,BRIDGE_CONFIG:config,BRIDGE_JOURNAL:path.join(dir,'commands.sqlite'),BRIDGE_SOCKET:sock,BRIDGE_PORT:'33165',BROWSER_SIP_PORT:'0'},stdio:['ignore','ignore','pipe']});child.stderr.on('data',b=>process.stderr.write(b));for(let i=0;i<60;i++){if(child.exitCode!==null)throw Error('Fixture exited '+child.exitCode);try{await control();return;}catch{await delay(50)}}throw Error('Bridge failed to start');}
async function stop(){peer?.terminate();if(child&&child.exitCode===null&&child.signalCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill();await ended;child=null;}fs.rmSync(sock,{force:true});}
function handshake(authorization,protocol='json'){return new Promise((resolve,reject)=>{const req=http.get({host:'127.0.0.1',port:33165,path:'/',headers:{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':Buffer.alloc(16,1).toString('base64'),'Sec-WebSocket-Protocol':protocol,...(authorization?{Authorization:authorization}:{})}},res=>{res.resume();resolve({status:res.statusCode});});req.on('upgrade',(res,socket)=>{resolve({status:res.statusCode,protocol:res.headers['sec-websocket-protocol']});socket.destroy();});req.on('error',reject);});}
async function connect(){peer=new WebSocket('ws://127.0.0.1:33165','json',{headers:{Authorization:auth}});peer.on('message',raw=>{const [method,args]=JSON.parse(raw);seen.push(method);if(method==='whoareyou')peer.send(JSON.stringify(['iam',{qid:args.qid,type:'commserver',name:'test',build:'test'}]));if(method==='cc_settaskactivity')peer.send(JSON.stringify(['cc_settaskactiveresult',{qid:args.qid,result:1}]));if(method==='login')peer.send(JSON.stringify(['loginresult',{qid:args.qid,result:1,sessionid:'redact-me',sippass:'redact-me'}]));});await new Promise((r,j)=>{peer.once('open',r);peer.once('error',j)});for(let i=0;i<30;i++){if((await control()).data.connected)return;await delay(20)}throw Error('Handshake missing');}
(async()=>{try{
 console.log('START isolated bridge tests');await start(true);
 assert.deepEqual((await control(null,'/pilot-changes?after=0')).data,{after:0,through:0,calls:[]});
 assert.equal((await control(null,'/pilot-changes?after=-1')).status,400);
 assert.equal((await control(null,'/pilot-changes?after=100')).status,409);
 assert.equal((await handshake()).status,401);assert.equal((await handshake('Basic wrong')).status,401);
 const legacy=await handshake(auth,'oktelltocrm json 1.0');assert.equal(legacy.status,101);assert.equal(legacy.protocol,'oktelltocrm json 1.0');await delay(100);
 await connect();assert.equal((await handshake(auth)).status,409);
 const call=(method,args)=>control({method,args});
 assert.match((await call('makecall',identity)).data.error,/not enabled/);
 assert.match((await call('login',{...identity,userid:'foreign'})).data.error,/Identity mismatch/);
 assert.match((await call('cc_settaskactive',{...identity,taskkey:'foreign',tasktype:'call',active:true})).data.error,/isolated task/);
 assert.match((await call('cc_addoperatortotask',{...identity,taskkey:task,operatorkey:'foreign'})).data.error,/test operators/);
 assert.match((await call('cc_settaskactive',{...identity,taskkey:task,tasktype:'call',active:'true'})).data.error,/Invalid task state/);
 const authResult=await call('login',identity);assert.equal(authResult.data.result,1);assert.equal(authResult.data.sessionid,undefined);assert.equal(authResult.data.sippass,undefined);
 assert.equal((await call('cc_settaskactive',{...identity,taskkey:task,tasktype:'call',active:false})).data.result,1);assert.ok(seen.includes('cc_settaskactivity'));assert.ok(!seen.includes('cc_settaskactive'));
 const waiting=call('getmyuserinfo',identity);await delay(50);peer.terminate();assert.match((await waiting).data.error,/Connection lost/);
 await stop();await start(false);await connect();assert.match((await call('cc_settaskactive',{...identity,taskkey:task,tasktype:'call',active:true})).data.error,/writes are disabled/);
 console.log('PASS: authentication, legacy protocol, duplicate peer, identity/task/operator scope, no dial API, secret redaction, 2.15 method mapping, disconnect ambiguity, write lock');
 }finally{await stop();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e.message);process.exitCode=1});
