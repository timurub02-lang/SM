'use strict';
const http=require('http'),crypto=require('crypto');
const {WebSocket,WebSocketServer}=require('ws');
const fail=(message,status=409)=>Object.assign(Error(message),{status});
function allowedSip(message,credentials,grant){
 if(message==='\r\n'||message==='\r\n\r\n')return true;
 if(typeof message!=='string'||message.length>65536)return false;
 const split=message.indexOf('\r\n\r\n');if(split<0)return false;
 const headers=message.slice(0,split),lengths=[...headers.matchAll(/^Content-Length:\s*(\d+)\s*$/gim)];
 if(lengths.length!==1||Buffer.byteLength(message.slice(split+4),'utf8')!==Number(lengths[0][1]))return false;
 if(/^SIP\/2\.0 [1-6][0-9]{2} /.test(message))return true;
 const request=/^([A-Z]+) (\S+) SIP\/2\.0\r\n/.exec(message);if(!request)return false;
 if(!['REGISTER','OPTIONS','ACK','CANCEL','BYE','INFO','UPDATE','PRACK','INVITE'].includes(request[1]))return false;
 const from=/^From:\s*.*<sip:([^@>]+)@/im.exec(message);
 if(!from||from[1]!==credentials.username)return false;
 if(request[1]==='INVITE'){
  const address=/^sip:([^@;]+)@([^;>]+)(?:;.*)?$/.exec(request[2]),target=address?.[1];
  if(address?.[2]!==credentials.domain)return false;
  const id=/^X-CRM-Call-ID:\s*([a-f0-9]{32})\s*$/im.exec(message)?.[1];
  const sipId=/^Call-ID:\s*(\S+)/im.exec(message)?.[1];
  if(!grant||Date.now()>grant.expires||target!==grant.destination||id!==grant.callId||!sipId)return false;
  if(grant.sipId&&grant.sipId!==sipId)return false;grant.sipId=sipId;
 }
 return true;
}
// Oktell 2.15 adds :5060 to a portless WSS Via. Restore only a matching request's sent-by.
function normalizeResponseVia(message,vias){
 if(!message.startsWith('SIP/2.0 '))return message;
 return message.replace(/^(Via:\s*SIP\/2\.0\/WSS )([^;\s]+)([^\r\n]*)/im,(all,prefix,sentBy,params)=>{
  const branch=/;branch=([^;\s]+)/i.exec(params)?.[1],original=branch&&vias.get(branch);
  return original&&sentBy===original+':5060'?prefix+original+params:all;
 });
}
// Native WebSocket registrations return the account at the proxy address, rather than echoing Contact.
function normalizeRegisterContact(message,registrations,username){
 if(!/^SIP\/2\.0 200 /.test(message))return message;
 const cseq=/^CSeq:\s*(\d+) REGISTER\s*$/im.exec(message)?.[1];
 const branch=/^Via:[^\r\n]*;branch=([^;\s]+)/im.exec(message)?.[1],request=branch&&registrations.get(branch);
 if(!request||request.cseq!==cseq)return message;
 return message.replace(/^Contact:\s*<sip:([^@>]+)@10\.20\.0\.10:\d+;transport=WS>([^\r\n]*)/im,(all,user,params)=>{
  const expires=/;expires=(\d+)/i.exec(params)?.[1]||/^Expires:\s*(\d+)\s*$/im.exec(message)?.[1];
  if(user!==username||expires===undefined||Number(expires)>86400)return all;
  return 'Contact: <'+request.uri+'>;expires='+expires;
 });
}
// The SIP proxy is on the private network, but the browser reaches media through the existing 1:1 UDP NAT.
function publishBrowserMedia(message){
 if(!/^(?:SIP\/2\.0 (?:18[03]|200) |INVITE )/.test(message)||!/^CSeq:\s*\d+ INVITE\s*$/im.test(message))return message;
 const split=message.indexOf('\r\n\r\n');if(split<0)return message;
 const headers=message.slice(0,split),body=message.slice(split+4);
 if(!/^Content-Type:\s*application\/sdp\s*$/im.test(headers)||!/^Content-Length:\s*\d+\s*$/im.test(headers))return message;
 const audio=/^m=audio (\d+) UDP\/TLS\/RTP\/SAVPF /m.exec(body);
 if(!audio||Number(audio[1])<20000||Number(audio[1])>20199)return message;
 let changed=false;
 let sdp=body.replace(/^(a=candidate:\S+ 1 UDP \d+ )10\.21\.103\.2 (\d+) typ host([^\r\n]*)/gim,(all,prefix,port,suffix)=>{
  if(port!==audio[1])return all;
  changed=true;return prefix+'185.162.93.10 '+port+' typ srflx raddr 10.21.103.2 rport '+port+suffix;
 });
 if(!changed)return message;
 sdp=sdp.replace(/^c=IN IP4 10\.21\.103\.2\r?$/gm,'c=IN IP4 185.162.93.10\r');
 return headers.replace(/^Content-Length:\s*\d+\s*$/im,'Content-Length: '+Buffer.byteLength(sdp,'utf8'))+'\r\n\r\n'+sdp;
}
module.exports=function({operators,connected,listen=true,upstreamUrl='ws://10.21.103.2:5060/',incoming=async()=>null}){
 const leases=new Map(),mutating=new Set();let generation=0;
 const state=actor=>{const lease=leases.get(actor);return ({connected:connected(),prepared:!!lease,registered:!!lease?.registered,calling:!!lease?.calling,call:lease?.call||null});};
 async function close(actor){const old=leases.get(actor);if(!old||mutating.has(actor))return;mutating.add(actor);try{old.client?.close();old.upstream?.close();await operators.release(actor,old.owner);if(leases.get(actor)===old)leases.delete(actor);}finally{mutating.delete(actor);}}
 const server=http.createServer((req,res)=>res.writeHead(404).end());
 const wss=new WebSocketServer({noServer:true,maxPayload:65536,handleProtocols:p=>p.has('sip')?'sip':false});
 server.on('upgrade',(req,socket,head)=>{
  const token=new URL(req.url,'http://localhost').searchParams.get('token');
  const lease=token&&[...leases.values()].find(l=>l.token===token);
  if(req.headers.origin!=='https://crm.smanalytics.ru'||!lease||lease.client||Date.now()>lease.tokenExpires||token!==lease.token||!req.headers['sec-websocket-protocol']?.split(',').map(x=>x.trim()).includes('sip')){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
  lease.token=null;const current=lease;
  wss.handleUpgrade(req,socket,head,client=>{
   current.client=client;
   const upstream=new WebSocket(upstreamUrl,'sip',{handshakeTimeout:8000,maxPayload:65536});current.upstream=upstream;
   const queue=[],vias=new Map(),registrations=new Map();
   client.on('message',raw=>{const text=raw.toString();if(!allowedSip(text,current.credentials,current.grant)){client.close(1008,'SIP operation not permitted');return;}
    const via=/^Via:\s*SIP\/2\.0\/WSS ([^;\s]+)[^\r\n]*;branch=([^;\s]+)/im.exec(text);if(via){if(vias.size>=100)vias.delete(vias.keys().next().value);vias.set(via[2],via[1]);
     if(text.startsWith('REGISTER ')){
      const uri=/^Contact:\s*<([^>]+)>/im.exec(text)?.[1],cseq=/^CSeq:\s*(\d+) REGISTER\s*$/im.exec(text)?.[1];
      if(uri&&cseq){if(registrations.size>=20)registrations.delete(registrations.keys().next().value);registrations.set(via[2],{uri,cseq});}
     }
    }
    if(/^SIP\/2\.0 200 /.test(text)&&current.incomingId===/^Call-ID:\s*(\S+)/im.exec(text)?.[1]&&/^CSeq:\s*\d+ INVITE/im.test(text)){current.calling=true;if(current.call){current.call.status='connected';current.call.answeredAt ||= new Date().toISOString();}}
    if(/^SIP\/2\.0 [3-6]\d\d /.test(text)&&current.incomingId===/^Call-ID:\s*(\S+)/im.exec(text)?.[1]&&/^CSeq:\s*\d+ INVITE/im.test(text)){current.calling=false;if(current.call){current.call.status='cancelled';current.call.endedAt=new Date().toISOString();}}
    if(text.startsWith('INVITE ')){current.calling=true;current.call={id:current.grant.callId,status:'dialing',startedAt:current.call?.id===current.grant.callId?current.call.startedAt:new Date().toISOString()};}
    if(text.startsWith('BYE ')||text.startsWith('CANCEL ')){current.calling=false;current.grant=null;if(current.call){current.call.status=current.call.status==='connected'?'ended':'cancelled';current.call.endedAt=new Date().toISOString();}}
    if(upstream.readyState===1)upstream.send(text);else if(queue.length<4)queue.push(text);else client.close(1008);
   });
   upstream.on('open',()=>{for(const text of queue)upstream.send(text);queue.length=0;});
   upstream.on('message',raw=>{const text=publishBrowserMedia(normalizeRegisterContact(normalizeResponseVia(raw.toString(),vias),registrations,current.credentials.username));
    if(text.startsWith('INVITE ')){
     const sipId=/^Call-ID:\s*(\S+)/im.exec(text)?.[1],number=/^From:\s*.*<sip:([^@>]+)@/im.exec(text)?.[1];
     if(current.incomingId===sipId&&current.calling){if(client.readyState===1)client.send(text);return;}
     const reject=()=>{if(upstream.readyState!==1)return;const headers=['Via','From','To','Call-ID','CSeq'].map(h=>text.match(new RegExp('^'+h+':[^\\r\\n]*','im'))?.[0]);if(headers.every(Boolean))upstream.send('SIP/2.0 486 Busy Here\r\n'+headers.map(h=>h.startsWith('To:')&&!/;tag=/i.test(h)?h+';tag=crm-rejected':h).join('\r\n')+'\r\nContent-Length: 0\r\n\r\n');};
     if(current.incomingPending===sipId)return;
     if(current.calling||current.incomingPending||current.grant&&Date.now()<current.grant.expires){reject();return;}
     current.incomingPending=sipId;
     void incoming(lease.actor,number,sipId).then(call=>{
      if(current.incomingPending!==sipId||client.readyState!==1)return;
      current.incomingPending=null;if(!call){reject();return;}
      current.incomingId=sipId;current.call=call;current.calling=true;client.send(text);
     }).catch(()=>{current.incomingPending=null;reject();});return;
    }
    if(text.startsWith('CANCEL ')){current.incomingPending=null;current.calling=false;if(current.call){current.call.status='cancelled';current.call.endedAt=new Date().toISOString();}}
    if(/^SIP\/2\.0 200 /m.test(text)&&/^CSeq:\s*\d+ REGISTER/im.test(text))current.registered=/^Contact:/im.test(text)&&!/^Contact:.*expires=0\b/im.test(text);
    if(current.call&&/^CSeq:\s*\d+ INVITE/im.test(text)){
     const code=Number(/^SIP\/2\.0 (\d+)/.exec(text)?.[1]);
     if(code===200){current.call.status='connected';current.call.answeredAt ||= new Date().toISOString();}
     else if(code>=300&&code!==401&&code!==407){current.calling=false;current.grant=null;current.call.status=code===486?'busy':code===480?'no_answer':'failed';}
    }
    if(text.startsWith('BYE ')){current.calling=false;current.grant=null;if(current.call)current.call.status='ended';}
    if(current.call&&!current.calling)current.call.endedAt ||= new Date().toISOString();
    if(client.readyState===1)client.send(text);
   });
   let didEnd=false;const ended=()=>{if(didEnd)return;didEnd=true;current.registered=false;current.calling=false;if(current.call&&!['ended','cancelled','failed','busy','no_answer'].includes(current.call.status))current.call.status='unknown';if(current.call)current.call.endedAt ||= new Date().toISOString();client.close();upstream.close();};
   client.on('error',ended);upstream.on('error',ended);client.on('close',ended);upstream.on('close',ended);
  });
 });
 if(listen)server.listen(Number(process.env.BROWSER_SIP_PORT??3315),'127.0.0.1');
 const timer=setInterval(()=>{for(const [actor,lease] of leases){if(lease.client?.readyState===1)lease.client.ping();if(Date.now()>lease.expires)void close(actor).catch(()=>{});}},10000);timer.unref();
 async function handle(req,res){
  try{
   if(req.method==='GET'){const actor=new URL(req.url,'http://localhost').searchParams.get('actor');operators.validate(actor);res.end(JSON.stringify(state(actor)));return;}
   if(req.method!=='POST')throw fail('Method not allowed',405);
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2048)throw fail('Payload too large',413);}
   const b=JSON.parse(raw);
   let lease=leases.get(b.actor);
   if(b.action!=='disconnect'||!lease)operators.validate(b.actor);
   if(!/^[a-f0-9]{64}$/.test(b.owner||''))throw fail('Телефон недоступен',403);
   if(!['connect','heartbeat','disconnect','authorize'].includes(b.action))throw fail('Неверная команда',400);
   if(mutating.has(b.actor))throw fail('Подключение уже выполняется');
   if(lease&&lease.owner!==b.owner)throw fail('Телефон уже подключён в другой вкладке');
   if(b.action==='connect'){
    if(lease)throw fail('Телефон уже подключён. Сначала отключите его');
    mutating.add(b.actor);const epoch=generation;try{
     const credentials=await operators.prepare(b.actor,b.owner);
     if(epoch!==generation||!connected())throw fail('Нет соединения с Oktell',503);
     lease={actor:b.actor,owner:b.owner,credentials,expires:Date.now()+90000,token:crypto.randomBytes(32).toString('hex'),tokenExpires:Date.now()+30000,registered:false,calling:false};
     leases.set(b.actor,lease);
     res.end(JSON.stringify({...credentials,token:lease.token,...state(b.actor)}));
    }finally{mutating.delete(b.actor);}
   }else{
    if(!lease&&b.action==='disconnect'){await operators.release(b.actor,b.owner);res.end(JSON.stringify(state(b.actor)));return;}
    if(!lease)throw fail('Подключите гарнитуру заново');
    if(b.action==='disconnect'){await close(b.actor);res.end(JSON.stringify(state(b.actor)));return;}
    lease.expires=Date.now()+90000;
    if(b.action==='authorize'){
     if(!lease.registered||lease.calling||lease.incomingPending||(lease.grant&&Date.now()<lease.grant.expires))throw fail('Телефон не готов к новому вызову');
     if(!/^7\d{10}$/.test(b.destination||'')||!/^[a-f0-9]{32}$/.test(b.callId||''))throw fail('Недопустимый номер клиента',403);
     lease.grant={callId:b.callId,destination:b.destination,expires:Date.now()+45000};
    }
    res.end(JSON.stringify(state(b.actor)));
   }
  }catch(e){res.writeHead(e.status||502).end(JSON.stringify({error:e.message}));}
 }
 return {handle,server,deploymentState:()=>({busy:mutating.size>0||[...leases.values()].some(l=>l.calling||l.incomingPending||l.grant&&Date.now()<l.grant.expires)}),disconnected:()=>{generation++;for(const lease of leases.values()){lease.client?.close();lease.upstream?.close();}leases.clear();},stop:async()=>{clearInterval(timer);await Promise.all([...leases.keys()].map(close));server.close();}};
};
module.exports.allowedSip=allowedSip;


module.exports.normalizeResponseVia=normalizeResponseVia;

module.exports.normalizeRegisterContact=normalizeRegisterContact;

module.exports.publishBrowserMedia=publishBrowserMedia;
