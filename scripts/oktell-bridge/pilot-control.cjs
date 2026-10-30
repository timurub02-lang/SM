'use strict';
const {DatabaseSync}=require('node:sqlite');
const {randomUUID,createHash}=require('node:crypto');
const fs=require('node:fs');
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
const lower=x=>String(x||'').toLowerCase();
const phone=x=>{const n=String(x||'').replace(/\D/g,'');return /^[78]\d{10}$/.test(n)?'7'+n.slice(1):null;};
const fail=(message,status=409)=>Object.assign(Error(message),{status});

// Only the separately commissioned pilot may use native incoming calls and result forms.
module.exports=function({send,request,connected,identity,file,load=()=>{
 try{return JSON.parse(fs.readFileSync(process.env.BRIDGE_PILOT||'/etc/sm-oktell-bridge/pilot.json','utf8'));}
 catch(e){if(e.code==='ENOENT')return null;throw e;}
},now=()=>Date.now()}){
 const db=new DatabaseSync(file);
 db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
 CREATE TABLE IF NOT EXISTS pilot_calls(chain TEXT PRIMARY KEY,actor TEXT NOT NULL,phone TEXT NOT NULL,client_id TEXT NOT NULL,started_at TEXT NOT NULL,answered_at TEXT,ended_at TEXT,status TEXT NOT NULL,commutation TEXT,sip_id TEXT,form_id TEXT,form_results TEXT,result TEXT,command_id TEXT,command_state TEXT,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS pilot_events(qid TEXT PRIMARY KEY,method TEXT NOT NULL,at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS pilot_commands(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,chain TEXT NOT NULL,state TEXT NOT NULL,at TEXT NOT NULL);`);
 db.exec(`CREATE TABLE IF NOT EXISTS pilot_updates(seq INTEGER PRIMARY KEY AUTOINCREMENT,chain TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS pilot_updates_chain ON pilot_updates(chain,seq);
 CREATE TRIGGER IF NOT EXISTS pilot_update_insert AFTER INSERT ON pilot_calls BEGIN INSERT INTO pilot_updates(chain) VALUES(NEW.chain); END;
 CREATE TRIGGER IF NOT EXISTS pilot_update_change AFTER UPDATE ON pilot_calls BEGIN INSERT INTO pilot_updates(chain) VALUES(NEW.chain); END;
 INSERT INTO pilot_updates(chain) SELECT chain FROM pilot_calls WHERE NOT EXISTS(SELECT 1 FROM pilot_updates);`);
 db.exec("UPDATE pilot_commands SET state='unknown' WHERE state='sent'; UPDATE pilot_calls SET command_state='unknown' WHERE command_state='sent'");
 const columns=new Set(db.prepare('PRAGMA table_info(pilot_calls)').all().map(c=>c.name));
 for(const column of ['task_id','delivery_id'])if(!columns.has(column))db.exec('ALTER TABLE pilot_calls ADD COLUMN '+column+' TEXT');
 db.exec(`CREATE TABLE IF NOT EXISTS pilot_deliveries(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,fingerprint TEXT NOT NULL,items TEXT,state TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS pilot_delivery_contacts(delivery_id TEXT NOT NULL,task_id TEXT NOT NULL,client_id TEXT NOT NULL,phone TEXT NOT NULL,active INTEGER NOT NULL,PRIMARY KEY(delivery_id,client_id));
 CREATE UNIQUE INDEX IF NOT EXISTS pilot_delivery_number ON pilot_delivery_contacts(task_id,phone) WHERE active=1;
 CREATE UNIQUE INDEX IF NOT EXISTS pilot_delivery_client ON pilot_delivery_contacts(task_id,client_id) WHERE active=1;`);
 function rememberDelivery(receipt,items){
  if(!receipt||!uuid(receipt.id)||!uuid(receipt.taskId)||!/^[a-f0-9]{64}$/.test(receipt.fingerprint)||typeof receipt.cancelled!=='boolean')throw fail('Invalid delivery receipt',502);
  const id=lower(receipt.id),task=lower(receipt.taskId),old=db.prepare('SELECT * FROM pilot_deliveries WHERE id=?').get(id);
  if(old&&(old.task_id!==task||old.fingerprint!==receipt.fingerprint))throw fail('Delivery receipt changed',502);
  let payload=null;
  if(items){
   if(!Array.isArray(items)||!items.length||items.length>1000||items.some(c=>!/^C-[\w-]+$/.test(c.clientId)||!phone(c.phone))||new Set(items.map(c=>c.clientId)).size!==items.length||new Set(items.map(c=>phone(c.phone))).size!==items.length)throw fail('Invalid delivery contacts',502);
   payload=JSON.stringify(items.map(c=>({clientId:c.clientId,phone:phone(c.phone)})).sort((a,b)=>a.clientId.localeCompare(b.clientId)));
   if(receipt.accepted!==items.length||old?.items&&old.items!==payload)throw fail('Delivery composition changed',502);
  }else if(!receipt.cancelled)throw fail('Delivery contacts required',502);
  // Cancellation is terminal even when an earlier import response arrives late.
  const cancelled=receipt.cancelled||old?.state==='cancelled';
  db.exec('BEGIN IMMEDIATE');try{
   db.prepare("INSERT INTO pilot_deliveries VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET items=COALESCE(pilot_deliveries.items,excluded.items),state=excluded.state").run(id,task,receipt.fingerprint,payload,cancelled?'cancelled':'delivered');
   if(cancelled)db.prepare('UPDATE pilot_delivery_contacts SET active=0 WHERE delivery_id=?').run(id);
   else for(const c of JSON.parse(payload))db.prepare('INSERT INTO pilot_delivery_contacts VALUES(?,?,?,?,1) ON CONFLICT(delivery_id,client_id) DO NOTHING').run(id,task,c.clientId,c.phone);
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 const stamp=()=>new Date(now()).toISOString();
 function config(){
  const p=load();if(!p)return null;
  if(!uuid(p.taskId)||!Array.isArray(p.operators)||(p.operators.length<1||p.operators.length>100)||!Array.isArray(p.contacts)||p.contacts.length!==3||
   p.operators.some(o=>!/^E-[\w-]+$/.test(o.actor)||!uuid(o.userid))||new Set(p.operators.map(o=>o.actor)).size!==p.operators.length||new Set(p.operators.map(o=>lower(o.userid))).size!==p.operators.length||
   p.contacts.some(c=>!phone(c.phone)||!/^C-[\w-]+$/.test(c.clientId))||new Set(p.contacts.map(c=>phone(c.phone))).size!==3||
   !Array.isArray(p.results)||p.results.some(r=>typeof r!=='string')||p.results.length<1)throw fail('Проверьте конфигурацию Т1',503);
  return p;
 }
 function operator(actor){const p=config(),o=p?.operators.find(o=>o.actor===actor);if(!o)throw fail('Нет доступа к Т1',403);const current=identity(actor);if(lower(current.userid)!==lower(o.userid))throw fail('Привязка оператора Т1 изменилась',403);return current;}
 function current(actor){return db.prepare("SELECT * FROM pilot_calls WHERE actor=? AND (ended_at IS NULL OR command_state IS NULL OR command_state!='confirmed') ORDER BY started_at DESC LIMIT 1").get(actor)||null;}
 function event(method,a){
  const p=config();if(!p||!a||!uuid(a.qid))return;
  const o=p.operators.find(o=>lower(o.userid)===lower(a.userid));if(!o)return;
  try{operator(o.actor);}catch{return;}
  if(db.prepare('SELECT 1 FROM pilot_events WHERE qid=?').get(a.qid)){if(method==='dlgcard_showformstop'&&current(o.actor)?.form_id===lower(a.idshow))send('dlgcard_showformdone',{...operator(o.actor),qid:randomUUID()});return;}
  const time=stamp(),chain=lower(a.chainid);
  if(['phoneevent_ringstarted','phoneevent_commstarted'].includes(method)){
   if(a.istask!==true||lower(a.taskid)!==lower(p.taskId)||!uuid(chain))return;
   const previous=db.prepare('SELECT * FROM pilot_calls WHERE chain=?').get(chain);
   const delivered=db.prepare('SELECT client_id clientId,phone,delivery_id deliveryId FROM pilot_delivery_contacts WHERE task_id=? AND phone=? AND active=1').get(lower(p.taskId),phone(a.callerid)||'');
   const contact=previous?{clientId:previous.client_id,phone:previous.phone,deliveryId:previous.delivery_id}:delivered||p.contacts.find(c=>phone(c.phone)===phone(a.callerid));
   if(!contact||phone(contact.phone)!==phone(a.callerid))return;
   if(previous&&(previous.actor!==o.actor||previous.phone!==phone(contact.phone)))return;
   db.prepare('INSERT OR IGNORE INTO pilot_calls(chain,actor,phone,client_id,started_at,status,updated_at,task_id,delivery_id) VALUES(?,?,?,?,?,?,?,?,?)').run(chain,o.actor,phone(contact.phone),contact.clientId,time,'ringing',time,lower(p.taskId),contact.deliveryId||null);
   if(method==='phoneevent_commstarted')db.prepare("UPDATE pilot_calls SET answered_at=COALESCE(answered_at,?),commutation=?,status=CASE WHEN ended_at IS NULL THEN 'connected' ELSE status END,updated_at=? WHERE chain=?").run(time,uuid(a.commutationid)?lower(a.commutationid):null,time,chain);
  }else if(['phoneevent_ringstopped','phoneevent_commstopped'].includes(method)){
   const c=db.prepare('SELECT * FROM pilot_calls WHERE chain=? AND actor=?').get(chain,o.actor);if(!c)return;
   if(method==='phoneevent_ringstopped'&&c.answered_at)return;
   db.prepare("UPDATE pilot_calls SET ended_at=COALESCE(ended_at,?),status=CASE WHEN answered_at IS NULL THEN 'no_answer' ELSE 'completed' END,updated_at=? WHERE chain=?").run(time,time,chain);
  }else if(method==='dlgcard_showformstop'){
   const c=current(o.actor);if(!c||!c.sip_id||c.ended_at&&now()-Date.parse(c.ended_at)>90000||!uuid(a.idshow)||a.taskid&&lower(a.taskid)!==lower(p.taskId))return;
   if(c.form_id&&lower(c.form_id)!==lower(a.idshow))return;
   const results=Array.isArray(a.userresults)?a.userresults.filter(r=>Number.isInteger(r.id)&&typeof r.name==='string'&&typeof r.issuccess==='boolean').map(r=>({id:r.id,val:r.name,issuc:r.issuccess})):[];
   db.prepare('UPDATE pilot_calls SET form_id=?,form_results=?,updated_at=? WHERE chain=?').run(lower(a.idshow),JSON.stringify(results),time,c.chain);
   send('dlgcard_showformdone',{...operator(o.actor),qid:randomUUID()});
  }else if(method==='dlgcard_closeall'){
   const c=current(o.actor);if(!c||c.command_state!=='sent'||a.idshow&&lower(a.idshow)!==c.form_id)return;
   db.prepare("UPDATE pilot_calls SET command_state='confirmed',updated_at=? WHERE chain=?").run(time,c.chain);
   db.prepare("UPDATE pilot_commands SET state='confirmed' WHERE id=? AND state='sent'").run(c.command_id);
  }else return;
  db.prepare('INSERT OR IGNORE INTO pilot_events VALUES(?,?,?)').run(a.qid,method,time);
 }
 async function incoming(actor,number,sipId){
  operator(actor);if(!phone(number)||!sipId||sipId.length>200)return null;
  // The PBX notification and SIP INVITE travel on different sockets.
  for(let n=0;n<30;n++){
   const c=current(actor);
   if(c&&c.phone===phone(number)&&!c.ended_at&&now()-Date.parse(c.started_at)<20000&&(!c.sip_id||c.sip_id===sipId)){
    db.prepare('UPDATE pilot_calls SET sip_id=? WHERE chain=?').run(sipId,c.chain);
    return {id:c.chain.replaceAll('-',''),chain:c.chain,direction:'incoming',clientId:c.client_id,phone:c.phone,status:c.status,startedAt:c.started_at};
   }
   if(!connected())return null;
   await new Promise(r=>setTimeout(r,100));
  }
  return null;
 }
 function read(actor){
  operator(actor);const c=current(actor);
  const latest=c||db.prepare('SELECT * FROM pilot_calls WHERE actor=? ORDER BY started_at DESC LIMIT 1').get(actor);
  return {configured:true,current:latest?{...latest,form_results:JSON.parse(latest.form_results||'[]'),result:latest.result?JSON.parse(latest.result):null}:null,results:config().results};
 }
 function result(actor,b){
  const ident=operator(actor),p=config();
  if(!b||Object.keys(b).some(k=>!['id','chain','outcome','comment','callbackAt'].includes(k))||!uuid(b.id)||!uuid(b.chain)||!p.results.includes(b.outcome)||typeof b.comment!=='string'||b.comment.length>3000)throw fail('Проверьте результат разговора',400);
  const fingerprint=createHash('sha256').update(JSON.stringify({actor,chain:b.chain,outcome:b.outcome,comment:b.comment,callbackAt:b.callbackAt||null})).digest('hex');
  const old=db.prepare('SELECT * FROM pilot_commands WHERE id=?').get(b.id);if(old){if(old.fingerprint!==fingerprint)throw fail('Команда уже использована');return {state:old.state};}
  const c=current(actor);if(!c||c.chain!==b.chain||!c.form_id||!c.ended_at||c.command_state)throw fail('Форма результата ещё не готова или уже отправлена');
  if(!connected())throw fail('Нет связи с Oktell',503);
  const callback=b.outcome==='Перезвон';
  if(callback&&(!b.callbackAt||!Number.isFinite(Date.parse(b.callbackAt))||Date.parse(b.callbackAt)<=now()||Date.parse(b.callbackAt)>now()+30*86400000)||!callback&&b.callbackAt)throw fail('Укажите будущее время перезвона в пределах 30 дней',400);
  const success=['Заказ','NEW ZAKAZ'].includes(b.outcome),items=JSON.parse(c.form_results||'[]');
  const native=items.find(r=>r.val===b.outcome&&r.issuc===success);
  // Native user results are optional. Preserve the exact CRM label in the PBX comment.
  const payload={...ident,qid:randomUUID(),idshow:c.form_id,issuccess:success,userresult:native?.id??null,comment:b.outcome+(b.comment?' · '+b.comment:''),nextcalltype:callback?'numberafter':'abonentnone',callatdatetime:null,callaftersec:callback?Math.max(1,Math.ceil((Date.parse(b.callbackAt)-now())/1000)):null,anothernumbers:[]};
  db.exec('BEGIN IMMEDIATE');try{
   db.prepare('INSERT INTO pilot_commands VALUES(?,?,?,?,?)').run(b.id,fingerprint,c.chain,'sent',stamp());
   db.prepare("UPDATE pilot_calls SET result=?,command_id=?,command_state='sent',updated_at=? WHERE chain=?").run(JSON.stringify({outcome:b.outcome,comment:b.comment,callbackAt:b.callbackAt||null}),b.id,stamp(),c.chain);db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
  try{send('dlgcard_setstopformresult',payload);}catch(e){db.prepare("UPDATE pilot_commands SET state='unknown' WHERE id=?").run(b.id);db.prepare("UPDATE pilot_calls SET command_state='unknown' WHERE chain=?").run(c.chain);throw fail('Результат отправки неизвестен. Не повторяйте команду до сверки с Oktell',502);}
  return {state:'sent'};
 }
 function disconnected(){db.exec("UPDATE pilot_commands SET state='unknown' WHERE state='sent'; UPDATE pilot_calls SET command_state='unknown' WHERE command_state='sent'");}
 function changes(after){
  if(!Number.isSafeInteger(after)||after<0)throw fail('Invalid history cursor',400);
  if(after>db.prepare('SELECT COALESCE(MAX(seq),0) seq FROM pilot_updates').get().seq)throw fail('History was restored or replaced; reconcile the CRM cursor',409);
  const calls=db.prepare('SELECT c.*,u.seq FROM pilot_calls c JOIN (SELECT chain,MAX(seq) seq FROM pilot_updates WHERE seq>? GROUP BY chain ORDER BY seq LIMIT 100) u ON u.chain=c.chain ORDER BY u.seq').all(after);
  return {after,through:calls.at(-1)?.seq??after,calls};
 }
 return {rememberDelivery,changes,event,incoming,read,result,operator,canAuthorize:actor=>{const c=current(actor);return !c||!!c.ended_at&&!c.form_id&&!c.answered_at;},busy:()=>!!db.prepare("SELECT 1 FROM pilot_calls WHERE ended_at IS NULL OR ((form_id IS NOT NULL OR answered_at IS NOT NULL) AND (command_state IS NULL OR command_state!='confirmed')) LIMIT 1").get(),configured:actor=>{try{return !!operator(actor);}catch{return false;}},disconnected,history:()=>db.prepare('SELECT * FROM pilot_calls ORDER BY started_at DESC LIMIT 100').all(),close:()=>db.close()};
};
