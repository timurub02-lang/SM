'use strict';
const {DatabaseSync}=require('node:sqlite');
const {createHash}=require('node:crypto');
const TASK='21d685d0-9cee-4af8-b2ea-dddde74e03a4',PROJECT='656001e1-c652-4e1f-a8fc-20b7f30b5e41';
const OPERATORS=[{key:'01',name:'CRM Test 01',userlogin:'crm_test_01',userid:'719b7385-440d-4276-ba6c-ec9c5cf2e9b5'},{key:'02',name:'CRM Test 02',userlogin:'crm_test_02',userid:'665e366c-7270-4010-8837-db877df38be3'}];
const ADMIN={userlogin:'Администратор',userid:'41f7dbe4-4052-4dde-8702-cfc8da42c989'};
const fail=(message,status=409)=>Object.assign(Error(message),{status});
const lower=v=>String(v).toLowerCase();
function rows(set){if(!Array.isArray(set)||!Array.isArray(set[0]))throw fail('Oktell не вернул состояние',502);return set.slice(1).map(row=>Object.fromEntries(set[0].map((k,i)=>[k,row[i]])));}
module.exports=function({request,connected,enabled,file}){
 const db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS commands(id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, operator TEXT, status TEXT NOT NULL, at TEXT NOT NULL, message TEXT NOT NULL)');
 db.exec("UPDATE commands SET status='unknown',message='Соединение прервано; сверьте состояние' WHERE status='pending'");
 let busy=false;
 async function read(){
  if(!connected())throw fail('Нет соединения с Oktell',503);
  const r=await request('execpredefineddbstoredproc',{procedure:'w_crm_isolatedtaskstate',inputparams:{}});
  if(r.result!==1||!Array.isArray(r.dataset)||r.dataset.length!==3){console.log(JSON.stringify({event:'state_read_failed',result:r.result,errorcode:r.errorcode,errorstr:r.errorstr,sets:r.dataset?.length}));throw fail('Не удалось прочитать состояние Oktell',502);}
  const tasks=rows(r.dataset[0]),members=rows(r.dataset[1]),counters=rows(r.dataset[2]);
  const t=tasks[0],counts=counters[0];
  if(tasks.length!==1||!t||lower(t.Id)!==TASK||counters.length!==1||![0,1].includes(t.Active))throw fail('Изолированная задача не найдена',409);
  const safe=t.Type===20&&t.Done===0&&lower(t.IdProject)===PROJECT&&lower(t.ListId)==='00000000-0000-0000-0000-000000000000'&&t.Name==='CRM NO CALLS 20261023'&&['ExternalLines','SipLines','TaskLines','Lists','CallSessions','FailedCalls','MissedCalls'].every(k=>counts[k]===0)&&members.every(m=>OPERATORS.some(o=>o.userid===lower(m.OperatorId))&&m.IsGroup===0);
  const operators=OPERATORS.map(o=>({key:o.key,name:o.name,assigned:members.some(m=>lower(m.OperatorId)===o.userid)}));
  const state={taskName:'CRM NO CALLS 20261023',active:t.Active===1,safe,operators,counts};
  return {...state,revision:createHash('sha256').update(JSON.stringify(state)).digest('hex'),checkedAt:new Date().toISOString(),enabled:enabled(),busy,journal:db.prepare('SELECT id,actor,action,operator,status,at,message FROM commands ORDER BY rowid DESC LIMIT 12').all()};
 }
 async function command(body){
  const {id,actor,action,operator,revision}=body;
  if(Object.keys(body).some(k=>!['id','actor','action','operator','revision'].includes(k))||!/^[-a-f0-9]{36}$/.test(id||'')||typeof actor!=='string'||!actor||actor.length>100||!['activate','deactivate','assign','remove'].includes(action)||!/^([a-f0-9]{64})$/.test(revision||'')||(['assign','remove'].includes(action)?!OPERATORS.some(o=>o.key===operator):operator!==undefined))throw fail('Недопустимая тестовая команда',400);
  const fingerprint=JSON.stringify({actor,action,operator,revision});
  const old=db.prepare('SELECT * FROM commands WHERE id=?').get(id);
  if(old){if(old.fingerprint!==fingerprint)throw fail('Идентификатор уже использован другой командой');return {receipt:old,replayed:true};}
  if(!enabled())throw fail('Управление тестовой задачей выключено',503);
  if(busy)throw fail('Предыдущая команда ещё выполняется');
  const o=OPERATORS.find(o=>o.key===operator),identity=o?{userid:o.userid,userlogin:o.userlogin}:ADMIN;
  busy=true;let inserted=false,logged=false,sent=false;
  try{
   const before=await read();
   if(before.revision!==revision)throw fail('Состояние изменилось. Обновите панель');
   if(!before.safe&&action!=='deactivate')throw fail('Условия изоляции нарушены. Разрешено только выключить задачу');
   db.prepare('INSERT INTO commands VALUES(?,?,?,?,?,?,?,?)').run(id,fingerprint,actor,action,operator||null,'pending',new Date().toISOString(),'Ожидается подтверждение Oktell');inserted=true;
   const login=await request('login',identity);if(login.result!==1)throw fail('Служебный вход Oktell недоступен. Закройте нативный сеанс соответствующей тестовой учётной записи',502);logged=true;
   if(o){const info=await request('getmyuserinfo',identity);if(info.isoperator!==true||info.hasline!==0||info.mainpbxnumber!=='')throw fail('Тестовый оператор изменён или получил телефонную линию');}
   const args={...identity,taskkey:TASK,...(o?{operatorkey:o.userid}:{tasktype:'call',active:action==='activate'})};
   sent=true;
   const reply=await request(o?(action==='assign'?'cc_addoperatortotask':'cc_removeoperatorfromtask'):'cc_settaskactive',args);
   if(reply.result!==1){sent=false;throw fail('Oktell отклонил команду ('+String(reply.errorcode||reply.result)+')',502);}
   let after;
   for(let i=0;i<6;i++){
    after=await read();
    const matches=o?after.operators.find(x=>x.key===operator).assigned===(action==='assign'):after.active===(action==='activate');
    if(matches){db.prepare("UPDATE commands SET status='confirmed',message='Подтверждено чтением Oktell' WHERE id=?").run(id);return {receipt:db.prepare('SELECT * FROM commands WHERE id=?').get(id),state:{...after,journal:undefined}};}
    await new Promise(r=>setTimeout(r,200));
   }
   throw fail('Ответ получен, но новое состояние ещё не подтверждено',502);
  }catch(e){
   if(inserted)db.prepare('UPDATE commands SET status=?,message=? WHERE id=?').run(sent?'unknown':'rejected',sent?'Результат не подтверждён. Обновите состояние; автоматического повтора нет':e.message,id);
   throw e;
  }finally{
   if(logged)try{await request('logout',identity);}catch{}
   busy=false;
  }
 }
 return {read,command};
};
