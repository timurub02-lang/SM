// Manual benchmark after `CRM_RUNTIME=miran next build --webpack`. Synthetic data only.
// Usage: node scripts/benchmark-crm-snapshot.mjs OUTPUT.json [scale=1] [samples=30]
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir,cpus} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {get,createServer} from 'node:http';
import {gunzipSync,brotliDecompressSync,inflateSync,createGzip} from 'node:zlib';
import {createHash} from 'node:crypto';
import {authSchema} from '../lib/auth-schema.ts';
import {hashPassword} from '../lib/auth-crypto.ts';
const [output,scaleText='1',sampleText='30']=process.argv.slice(2),scale=Number(scaleText),samples=Number(sampleText);
assert.ok(output&&scale>0&&scale<=4&&Number.isInteger(samples)&&samples>=5);
const counts={clients:Math.round(5423*scale),orders:Math.round(7839*scale),events:Math.round(20275*scale)};
assert.ok(Object.values(counts).every(n=>n>0));
const dir=mkdtempSync(join(tmpdir(),'crm-snapshot-')),path=join(dir,'synthetic.sqlite'),db=new DatabaseSync(path);
const port=process.env.BENCH_PORT||'3098',base=`http://127.0.0.1:${port}`,origin='https://crm.test';
const at='2026-11-01T12:00:00.000Z',password='synthetic-benchmark-only-123';
const digest=x=>createHash('sha256').update(x).digest('hex');
const text=(kind,id,length)=>Array.from({length:Math.ceil(length/64)},(_,n)=>digest(`${kind}:${id}:${n}`)).join('').slice(0,length);
let server,proxy,logs='';
try{
 db.exec(readFileSync(new URL('../drizzle/0000_cynical_monster_badoon.sql',import.meta.url),'utf8'));
 for(const sql of authSchema)db.exec(sql);
 const hash=await hashPassword(password);
 const staff=[{id:'admin',role:'admin',department:''},{id:'head',role:'department_head',department:'1'},...Array.from({length:40},(_,i)=>({id:'operator-'+i,role:'operator',department:String(i%4+1)}))];
 for(const e of staff){Object.assign(e,{login:e.id,name:'Synthetic '+e.id,alias:'',skLogin:'',salary:100,bonus:1,version:1});db.prepare('INSERT INTO employees(id,data) VALUES(?,?)').run(e.id,JSON.stringify(e));if(['admin','head','operator-0'].includes(e.id))db.prepare('INSERT INTO auth_accounts VALUES(?,?,1)').run(e.id,hash);}
 const setting=db.prepare('INSERT INTO settings VALUES(?,?)');setting.run('main',JSON.stringify({retentionDays:30}));
 setting.run('premium-ledger',JSON.stringify({revision:'synthetic',activePeriod:'2026-11-1',initialPeriod:'2026-11-1',periods:{'2026-11-1':{status:'open',signatures:{}}}}));
 const insertClient=db.prepare('INSERT INTO clients(id,phone,data) VALUES(?,?,?)'),insertOrder=db.prepare('INSERT INTO orders(id,client_id,data) VALUES(?,?,?)'),insertEvent=db.prepare('INSERT INTO events(id,client_id,order_id,at,data) VALUES(?,?,?,?,?)');
 db.exec('BEGIN');
 for(let i=0;i<counts.clients;i++){
  const id='c-'+i,phone='+7999'+String(i).padStart(7,'0'),c={id,phone,name:'Synthetic client '+i,owner:'operator-'+i%40,city:'Тестовый город',address:'Синтетический адрес '+i,source:'Benchmark',sheet:'К',returnSheet:'П',assignedUntil:'',assignmentStartedAt:at,createdAt:at,biography:text('biography',i,600),importFields:{Note:text('import',i,350)},legacyOrderHistory:[],version:1};
  insertClient.run(id,phone,JSON.stringify(c));
 }
 for(let i=0;i<counts.orders;i++){
  const id='o-'+i,client=i%counts.clients,o={id,clientId:'c-'+client,manager:'operator-'+client%40,logistic:'',status:'pickup',items:[{name:'Синтетический товар',qty:1,price:1000}],comment:text('comment',i,650),reason:'',contact:'none',due:'',round:0,extra:false,delivery:'cdek_pickup',address:'Синтетический адрес '+client,addressParts:{city:'Тестовый город',street:'Тестовая',house:String(client)},legacyLv:{orderId:String(i),track:'TRACK-'+i,comment:text('legacy',i,450)},createdAt:at,updatedAt:at,version:1};
  insertOrder.run(id,o.clientId,JSON.stringify(o));
  if(i%3===0)setting.run('cdek-shipment-'+id,JSON.stringify({state:i%6===0?'ready':'deleting',number:'SYNTHETIC-'+i,downloadedAt:i%12===0?at:null,request:text('shipment',i,1000)}));
 }
 for(let i=0;i<counts.events;i++){
  const order=i%counts.orders,e={id:'e-'+i,clientId:'c-'+order%counts.clients,orderId:'o-'+order,at,actor:'Synthetic',text:'Синтетическое событие '+text('event',i,190)};
  insertEvent.run(e.id,e.clientId,e.orderId,e.at,JSON.stringify(e));
 }
 db.exec('COMMIT');
 server=spawn(process.execPath,[resolve('.next/standalone/server.js')],{env:{...process.env,CRM_RUNTIME:'miran',CRM_ORIGIN:origin,CRM_DATABASE_PATH:path,HOSTNAME:'127.0.0.1',PORT:port},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',x=>logs+=x);server.stderr.on('data',x=>logs+=x);
 let ready=false;for(let i=0;i<150;i++){try{await fetch(base+'/login');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(ready,'Server did not start');
 // Next's route response is uncompressed here. Model the production gzip proxy for BOTH builds.
 proxy=createServer((request,response)=>{
  get(base+request.url,{headers:request.headers},upstream=>{
   const headers={...upstream.headers};delete headers['content-length'];
   const gzip=upstream.statusCode===200&&!headers['content-encoding'];
   if(gzip)headers['content-encoding']='gzip';
   response.writeHead(upstream.statusCode,headers);
   upstream.on('error',error=>response.destroy(error));
   if(gzip){const encoder=createGzip({level:6});encoder.on('error',error=>response.destroy(error));upstream.pipe(encoder).pipe(response);}else upstream.pipe(response);
  }).on('error',error=>response.destroy(error));
 });
 proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
 const snapshotBase=`http://127.0.0.1:${proxy.address().port}`;
 function snapshot(cookie,etag){return new Promise((resolve,reject)=>{
  const start=performance.now();get(snapshotBase+'/api/crm',{headers:{cookie,'Accept-Encoding':'gzip, deflate, br',...(etag?{'If-None-Match':etag}:{})}},r=>{
   const ttfb=performance.now()-start,chunks=[];r.on('data',x=>chunks.push(x));r.on('error',reject);r.on('end',()=>{
    const elapsed=performance.now()-start,encoded=Buffer.concat(chunks),encoding=r.headers['content-encoding']||'identity';
    const decoded=r.statusCode===304?encoded:encoding==='br'?brotliDecompressSync(encoded):encoding==='gzip'?gunzipSync(encoded):encoding==='deflate'?inflateSync(encoded):encoded;
    const timing=Object.fromEntries([...String(r.headers['server-timing']).matchAll(/(crm_\w+);dur=([\d.]+)/g)].map(m=>[m[1],Number(m[2])]));
    resolve({status:r.statusCode,etag:r.headers.etag,encoding,encodedBytes:encoded.length,decodedBytes:decoded.length,sha256:digest(decoded),elapsed,ttfb,...timing,...(!etag?{data:JSON.parse(decoded)}:{})});
   });
  }).on('error',reject);
 });}
 const cases=[];
 for(const role of ['admin','operator-0','head']){
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({login:role,password})});assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  let warm;for(let i=0;i<5;i++){warm=await snapshot(cookie);assert.equal(warm.status,200);}
  const {data}=warm;
  assert.equal(new Set(data.orders.map(o=>o.id)).size,data.orders.length);
  assert.equal(new Set(data.clients.map(c=>c.id)).size,data.clients.length);
  if(role==='admin'){assert.equal(data.clients.length,counts.clients);assert.equal(data.orders.length,counts.orders);assert.equal(data.events.length,counts.events);}
  else {
   const visibleClient=i=>role==='operator-0'?i%40===0:i%4===0;
   assert.equal(data.clients.length,Array.from({length:counts.clients},(_,i)=>i).filter(visibleClient).length);
   assert.equal(data.orders.length,Array.from({length:counts.orders},(_,i)=>i%counts.clients).filter(visibleClient).length);
   assert.equal(data.events.length,Array.from({length:counts.events},(_,i)=>i%counts.orders%counts.clients).filter(visibleClient).length);
   assert.ok(data.orders.every(o=>role==='operator-0'?o.manager===role:Number(o.manager.split('-')[1])%4===0));assert.ok(data.clients.every(c=>c.phone===''&&!c.importFields));
  }
  const rows=[];for(let i=0;i<samples;i++){const {data,...r}=await snapshot(cookie);assert.equal(r.status,200);assert.equal(r.sha256,warm.sha256,'Warm snapshot must remain stable');rows.push(r);}
  const unchanged=[];for(let i=0;i<samples;i++){const r=await snapshot(cookie,warm.etag);assert.equal(r.status,304);assert.equal(r.encodedBytes,0);unchanged.push(r);}
  const summarize=rs=>Object.fromEntries(['elapsed','ttfb','crm_snapshot','crm_total','encodedBytes','decodedBytes'].map(k=>{const values=rs.map(r=>r[k]).sort((a,b)=>a-b);return [k,{p50:values[Math.ceil(values.length*.5)-1],p95:values[Math.ceil(values.length*.95)-1]}];}));
  cases.push({role,visible:{clients:data.clients.length,orders:data.orders.length,events:data.events.length},sha256:warm.sha256,encoding:warm.encoding,summary:summarize(rows),unchangedSummary:summarize(unchanged),rows,unchanged});
  console.log(JSON.stringify({role,summary:cases.at(-1).summary}));
 }
 writeFileSync(output,JSON.stringify({synthetic:true,proxy:'gzip level 6 when upstream has no Content-Encoding',node:process.version,cpu:cpus()[0].model,scale,counts,samples,warmup:5,cases},null,2)+'\n');
}catch(error){console.error(logs);throw error;}finally{
 if(proxy)await new Promise(resolve=>proxy.close(resolve));
 if(server&&server.exitCode===null&&server.signalCode===null){server.kill();await once(server,'exit');}
 db.close();assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'crm-snapshot-'));rmSync(dir,{recursive:true,force:true});
}
