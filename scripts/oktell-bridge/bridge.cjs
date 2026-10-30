'use strict';
const http=require('http'),fs=require('fs'),crypto=require('crypto');
const {WebSocketServer}=require('ws');
const cfg=JSON.parse(fs.readFileSync(process.env.BRIDGE_CONFIG||'/etc/sm-oktell-bridge/config.json'));
const authorization='Basic '+Buffer.from(cfg.login+':'+cfg.password).toString('base64');
let peer=null,hello=null,connectedAt=null,lastSeen=null;const pending=new Map();
const publicState=()=>({connected:!!peer&&peer.readyState===1&&!!hello,hello,connectedAt,lastSeen,pending:pending.size,scope:'isolated_test_only',realCallingEnabled:false,commissioningWrites:cfg.commissioningWrites===true});
const send=(method,args)=>{if(!peer||peer.readyState!==1)throw Error('Oktell disconnected');peer.send(JSON.stringify([method,args]));};
// Oktell 2.15 uses cc_settaskactivity on the wire and cc_settaskactiveresult in replies.
const request=(method,args={})=>new Promise((resolve,reject)=>{if(pending.size>=512)return reject(Error('Busy'));const qid=crypto.randomUUID();const timeout=setTimeout(()=>{pending.delete(qid);reject(Error('Oktell response timeout; result unknown'));},8000);pending.set(qid,{resolve,reject,timeout,method});try{send(method==='cc_settaskactive'?'cc_settaskactivity':method,{...args,qid})}catch(e){clearTimeout(timeout);pending.delete(qid);reject(e)}});
const auditAuth=req=>{const value=req.headers.authorization||'';let loginMatches=false,passwordMatches=false;if(value.startsWith('Basic ')){const decoded=Buffer.from(value.slice(6),'base64').toString();const split=decoded.indexOf(':');loginMatches=decoded.slice(0,split)===cfg.login;passwordMatches=decoded.slice(split+1)===cfg.password;}console.log(JSON.stringify({event:'handshake',upgrade:req.headers.upgrade||null,protocols:req.headers['sec-websocket-protocol']||null,scheme:value.split(' ')[0]||null,loginMatches,passwordMatches}));};
const server=http.createServer((req,res)=>{auditAuth(req);res.writeHead(401,{'WWW-Authenticate':'Basic realm="Oktell CRM"'});res.end();});
const wss=new WebSocketServer({noServer:true,maxPayload:1024*1024,handleProtocols:protocols=>[...protocols].find(p=>p.toLowerCase().includes('json'))||false});
wss.on('headers',(headers,req)=>{if(req.oktellLegacyJson){const i=headers.findIndex(h=>h.toLowerCase().startsWith('sec-websocket-protocol:'));if(i>=0)headers[i]='Sec-WebSocket-Protocol: oktelltocrm json 1.0';}});
wss.on('wsClientError',(error,socket)=>{console.log(JSON.stringify({event:'websocket_rejected',reason:error.message}));socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');});
server.on('upgrade',(req,socket,head)=>{
 auditAuth(req);
 const supplied=Buffer.from(req.headers.authorization||''),expected=Buffer.from(authorization);
 if(req.url!=='/'||supplied.length!==expected.length||!crypto.timingSafeEqual(supplied,expected)){socket.end('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="Oktell CRM"\r\nConnection: close\r\n\r\n');return;}
 if(peer){socket.end('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n');return;}
 // Windows 2.15 sends this exact legacy subprotocol with spaces, outside RFC token syntax.
 // Normalize only the observed value for ws parsing, and echo the original to Oktell.
 if(req.headers['sec-websocket-protocol']==='oktelltocrm json 1.0'){req.oktellLegacyJson=true;req.headers['sec-websocket-protocol']='oktelltocrm-json-1.0';}
 wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));
});
wss.on('connection',ws=>{
 peer=ws;hello=null;connectedAt=new Date().toISOString();console.log(JSON.stringify({event:'connected',at:connectedAt}));
 ws.on('message',raw=>{try{
  const message=JSON.parse(raw.toString());if(!Array.isArray(message)||message.length!==2||typeof message[0]!=='string'||!message[1]||typeof message[1]!=='object')return;
  const [method,args]=message;lastSeen=new Date().toISOString();console.log(JSON.stringify({event:'message',method,qid:args.qid||null}));
  if(method==='whoareyou')send('iam',{qid:args.qid,type:'crm-server',name:'SM CRM isolated pilot',version:1});
  else if(method==='getavailablemethods')send('availablemethods',{qid:args.qid,methods:[]});
  else if(method==='getavailableforms')send('availableforms',{qid:args.qid,forms:[]});
  else if(method==='getactiveusers')send('activeusers',{qid:args.qid,users:operators.activeUsers()});
  else if(method==='iam')hello={type:args.type,name:args.name,version:args.version,build:args.build};
  pilot.event(method,args);
  const match=pending.get(args.qid);if(match&&(method===match.method+'result'||(match.method==='setuserstate'&&method==='userstatechanged')||(match.method==='whoareyou'&&method==='iam')||(match.method==='ping'&&method==='pong'))){clearTimeout(match.timeout);pending.delete(args.qid);match.resolve({method,...args});}
 }catch{console.log('{"event":"invalid_message"}');}});
 ws.on('error',()=>{});
 ws.on('close',()=>{if(peer===ws){peer=null;hello=null;operators.disconnected();browserPhone.disconnected();pilot.disconnected();for(const p of pending.values()){clearTimeout(p.timeout);p.reject(Error('Connection lost; result unknown'))}pending.clear();console.log('{"event":"disconnected"}')}});
 setTimeout(()=>{if(peer===ws)request('whoareyou',{type:'crm-server',name:'SM CRM isolated pilot',version:1}).catch(()=>ws.close());},500);
});
server.listen(Number(process.env.BRIDGE_PORT||3305),'127.0.0.1');
const tasks=require('./task-control.cjs')({request,connected:()=>publicState().connected,enabled:()=>cfg.testControl===true,file:process.env.BRIDGE_JOURNAL||'/var/lib/sm-oktell-bridge/commands.sqlite'});
const operators=require('./linked-operators.cjs')({request,connected:()=>publicState().connected});
const pilot=require('./pilot-control.cjs')({send,request,callbackRouting:cfg.callbackRouting===true,connected:()=>publicState().connected,identity:operators.identity,file:process.env.BRIDGE_PILOT_JOURNAL||(process.env.BRIDGE_JOURNAL?process.env.BRIDGE_JOURNAL+'.pilot':'/var/lib/sm-oktell-bridge/pilot.sqlite')});
setInterval(()=>pilot.syncCallbacks().catch(()=>console.log('{"event":"callback_route_sync_failed"}')),2000).unref();
const browserOperators={...operators,prepare:async(actor,owner)=>{
 const credentials=await operators.prepare(actor,owner);
 try{if(pilot.configured(actor))await request('dlgcard_setsupported',{...operators.identity(actor),supported:true});return credentials;}
 catch(e){await operators.release(actor,owner);throw e;}
}};
const browserPhone=require('./browser-phone.cjs')({operators:browserOperators,connected:()=>publicState().connected,incoming:pilot.incoming,canAuthorize:pilot.canAuthorize});
const delivery=require('./delivery-control.cjs')({request,connected:()=>publicState().connected});
const control=http.createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
 if(req.method==='GET'&&req.url==='/status'){res.end(JSON.stringify(publicState()));return;}
 if(req.url==='/delivery'){
  try{
   if(req.method==='GET'){res.end(JSON.stringify(await delivery.state()));return;}
   if(req.method!=='POST')throw Object.assign(Error('Method not allowed'),{status:405});
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>500000)throw Object.assign(Error('Payload too large'),{status:413});}
   const {action,...body}=JSON.parse(raw);if(!['import','cancel'].includes(action))throw Object.assign(Error('Invalid action'),{status:400});
   res.end(JSON.stringify(await (action==='import'?delivery.importBatch(body):delivery.cancel(body))));
  }catch(e){res.writeHead(e.status||502).end(JSON.stringify({error:e.message}));}return;
 }
 if(req.method==='GET'&&req.url==='/deployment-state'){res.end(JSON.stringify({busy:browserPhone.deploymentState().busy||pilot.busy()}));return;}
 if(req.method==='GET'&&req.url==='/pilot-history'){res.end(JSON.stringify(pilot.history()));return;}
 if(req.method==='GET'&&req.url?.startsWith('/pilot-changes?')){
  try{const url=new URL(req.url,'http://localhost'),after=url.searchParams.get('after');if(!/^\d+$/.test(after||''))throw Object.assign(Error('Invalid cursor'),{status:400});res.end(JSON.stringify(pilot.changes(Number(after))));}
  catch(e){res.writeHead(e.status||502).end(JSON.stringify({error:e.message}));}return;
 }
 if(req.url?.startsWith('/browser-phone')){await browserPhone.handle(req,res);return;}
 if(req.url?.startsWith('/pilot')){
  try{const url=new URL(req.url,'http://localhost');if(url.pathname!=='/pilot')throw Object.assign(Error('Not found'),{status:404});
   const actor=url.searchParams.get('actor');if(req.method==='GET'){res.end(JSON.stringify(pilot.read(actor)));return;}
   if(req.method!=='POST')throw Object.assign(Error('Method not allowed'),{status:405});
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>8192)throw Object.assign(Error('Payload too large'),{status:413});}
   res.end(JSON.stringify(pilot.result(actor,JSON.parse(raw))));
  }catch(e){res.writeHead(e.status||502).end(JSON.stringify({error:e.message}));}return;
 }
 if(req.url?.startsWith('/operator')){
  try{
   const url=new URL(req.url,'http://localhost');
   if(url.pathname!=='/operator')throw Object.assign(Error('Not found'),{status:404});
   if(req.method==='GET'){res.end(JSON.stringify(await operators.read(url.searchParams.get('actor'))));return;}
   if(req.method!=='POST')throw Object.assign(Error('Method not allowed'),{status:405});
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>2048)throw Object.assign(Error('Payload too large'),{status:413});}
   res.end(JSON.stringify(await operators.command(JSON.parse(raw))));
  }catch(e){res.writeHead(e.status||502).end(JSON.stringify({error:e.message}));}return;
 }
 if(req.url==='/test-task'){
  try{
   if(req.method==='GET'){res.end(JSON.stringify(await tasks.read()));return;}
   if(req.method!=='POST'){res.writeHead(405).end('{}');return;}
   let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)throw Object.assign(Error('Payload too large'),{status:413});}
   const result=await tasks.command(JSON.parse(raw));
   if(result.receipt)delete result.receipt.fingerprint;
   res.end(JSON.stringify(result));
  }catch(e){res.writeHead(e.status||502).end(JSON.stringify({error:e.message}));}return;
 }
 if(req.method!=='POST'||req.url!=='/query'){res.writeHead(404).end('{}');return;}
 try{
  let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>8192)throw Error('Payload too large');}
  const {method,args={}}=JSON.parse(raw);
  const allowed=['ping','whoareyou','getallusernumbers','checkuserintask','getmyuserinfo','login','logout','cc_addoperatortotask','cc_removeoperatorfromtask','cc_settaskactive'];
  if(!allowed.includes(method))throw Error('Operation is not enabled; read-only commissioning');
  const permitted=new Set(['userid','userlogin','taskkey','operatorkey','tasktype','active']);if(Object.keys(args).some(k=>!permitted.has(k)))throw Error('Unexpected parameter');
  if(!['ping','whoareyou'].includes(method)&&!['crm_test_01','crm_test_02','Администратор'].includes(args.userlogin))throw Error('Only commissioned test identities are allowed');
  const identities={'crm_test_01':'719b7385-440d-4276-ba6c-ec9c5cf2e9b5','crm_test_02':'665e366c-7270-4010-8837-db877df38be3','\u0410\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440':'41f7dbe4-4052-4dde-8702-cfc8da42c989'};
  if(!['ping','whoareyou'].includes(method)&&identities[args.userlogin]!==args.userid)throw Error('Identity mismatch');
  if(method.startsWith('cc_')){
   if(cfg.commissioningWrites!==true)throw Error('Commissioning writes are disabled');
   if(args.taskkey!=='21d685d0-9cee-4af8-b2ea-dddde74e03a4')throw Error('Only isolated task is allowed');
   if(method==='cc_settaskactive'){if(args.tasktype!=='call'||typeof args.active!=='boolean')throw Error('Invalid task state');}
   else if(!['719b7385-440d-4276-ba6c-ec9c5cf2e9b5','665e366c-7270-4010-8837-db877df38be3'].includes(args.operatorkey))throw Error('Only test operators are allowed');
  }
  // Scheme 1 uses the authenticated CRM connection; no operator password is sent.
  const result=await request(method,args);for(const key of ['sessionid','sippass','password','Password'])delete result[key];res.end(JSON.stringify(result));
 }catch(e){res.writeHead(502).end(JSON.stringify({error:e.message}));}
});
const socket=process.env.BRIDGE_SOCKET||'/run/sm-oktell-bridge/control.sock';if(fs.existsSync(socket))fs.unlinkSync(socket);
control.listen(socket,()=>fs.chmodSync(socket,0o660));
setInterval(()=>{if(peer)request('ping').catch(()=>peer?.close())},30000).unref();
