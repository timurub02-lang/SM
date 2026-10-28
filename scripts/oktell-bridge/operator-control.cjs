'use strict';
const reasons=['Обед','Короткий перерыв'];
const fail=(message,status=409)=>Object.assign(Error(message),{status});
module.exports=function({request:send,connected,identity:IDENTITY,actor:ACTOR}){
 let generation=0;
 const request=async(method,args)=>{const epoch=generation;const result=await send(method,args);if(epoch!==generation)throw fail('Соединение с Oktell изменилось',503);return result;};
 let busy=false,logged=false,info=null,browserOwner=null,browserCredentials=null;
 const activeUsers=()=>logged?[IDENTITY]:[];
 const disconnected=()=>{generation++;logged=false;info=null;browserOwner=null;browserCredentials=null;};
 const allowed=actor=>{if(actor!==ACTOR)throw fail('Учётная запись Oktell ещё не подключена для этого сотрудника',403);if(!connected())throw fail('Нет соединения с Oktell',503);};
 async function read(actor){
  allowed(actor);
  if(!logged)return {connected:true,state:'offline',checkedAt:new Date().toISOString(),login:IDENTITY.userlogin,hasLine:info?Number(info.hasline)>0:null,busy};
  const s=await request('getuserstate',IDENTITY);
  if(!Number.isInteger(s.userstateid))throw fail('Oktell не подтвердил состояние сотрудника',502);
  const state=info&&!(Number(info.hasline)>0)?'unavailable':s.onlunch===true?'break':s.oncallcenter===true?(s.userstateid===1?'ready':'busy'):'finished';
  return {connected:true,state,userStateId:s.userstateid,onCallCenter:s.oncallcenter===true,onLunch:s.onlunch===true,checkedAt:new Date().toISOString(),login:IDENTITY.userlogin,hasLine:info?Number(info.hasline)>0:null,busy};
 }
 async function command(body){
  if(!body||Object.keys(body).some(k=>!['actor','action','reason'].includes(k))||!['ready','break','finish'].includes(body.action)||body.action==='break'&&!reasons.includes(body.reason)||body.action!=='break'&&body.reason!==undefined)throw fail('Неверная команда',400);
  allowed(body.actor);if(body.action==='finish'&&browserOwner)throw fail('Сначала отключите гарнитуру в CRM');if(busy)throw fail('Предыдущая команда ещё выполняется');busy=true;
  try{
   if(!logged){const r=await request('login',IDENTITY);if(r.result!==1){console.log(JSON.stringify({event:'operator_login_rejected',result:r.result,errorcode:r.errorcode}));throw fail('Oktell не разрешил вход. Код: '+String(r.errorcode||r.result),502);}logged=true;}
   info=await request('getmyuserinfo',IDENTITY);
   if(info.isoperator!==true)throw fail('В Oktell не подтверждена роль оператора',502);
   if(body.action!=='finish'&&!(Number(info.hasline)>0))throw fail('К сотруднику пока не подключён телефон Oktell. Приём звонков ещё недоступен');
   if(body.action==='ready'){
    const task=await request('checkuserintask',IDENTITY);
    if(task.intask!==true)throw fail('Оператор пока не включён в задачу Oktell. Приём звонков ещё недоступен');
   }
   const desired=body.action==='ready'?{userstateid:1,oncallcenter:true,onccmanual:false,onlunch:false}:body.action==='break'?{userstateid:2,onlunch:true,lunchreasonmsg:body.reason}:{userstateid:3,oncallcenter:false,onccmanual:false,onlunch:false};
   // Some builds emit userstatechanged without qid. Verify by reading; never retry the write.
   let writeError;try{const reply=await request('setuserstate',{...IDENTITY,...desired});if(reply.result!==undefined&&reply.result!==1)throw fail('Oktell отклонил статус. Код: '+String(reply.errorcode||reply.result),502);}catch(e){writeError=e;}
   const after=await read(body.actor);
   const matches=body.action==='ready'?after.onCallCenter&&!after.onLunch&&after.userStateId===1:body.action==='break'?after.onLunch:!after.onCallCenter&&!after.onLunch;
   if(!matches)throw fail(writeError?'Результат команды не подтверждён. Обновите состояние':'Oktell не применил выбранный статус',502);
   if(body.action==='finish'){const r=await request('logout',IDENTITY);if(r.result!==1)throw fail('Выход из Oktell не подтверждён',502);disconnected();}
   console.log(JSON.stringify({event:'operator_state_confirmed',actor:body.actor,action:body.action,reason:body.reason||null,at:new Date().toISOString()}));
   return {...after,state:body.action==='finish'?'offline':after.state,busy:false};
  }finally{busy=false;}
 }
 async function prepare(actor,owner){
  allowed(actor);
  if(!/^[a-f0-9]{64}$/.test(owner||''))throw fail('Неверный сеанс',403);
  if(busy)throw fail('Предыдущая команда ещё выполняется');
  if(browserOwner&&browserOwner!==owner)throw fail('Телефон уже подключён в другой вкладке');
  if(browserCredentials)return browserCredentials;
  busy=true;
  try{
  if(logged&&info&&Number(info.hasline)===0){const r=await request('logout',IDENTITY);if(r.result!==1)throw fail('Сначала завершите предыдущий сеанс Oktell');disconnected();}
  if(logged)throw fail('Сначала завершите предыдущий сеанс Oktell');
   const r=await request('login',{...IDENTITY,usewebrtc:1});
   if(r.result!==1)throw fail('Oktell не разрешил подключение телефона',502);
   logged=true;browserOwner=owner;
   if(!r.sipuser||!r.siplogin||!r.sippass){await request('logout',IDENTITY);disconnected();throw fail('Oktell не выдал параметры браузерного телефона',502);}
   browserCredentials={username:r.sipuser,authorizationUsername:r.siplogin,password:r.sippass,domain:r.sipdomain||'10.21.103.2',port:r.sipport||5060};
   return browserCredentials;
  }finally{busy=false;}
 }
 async function release(actor,owner){
  allowed(actor);if(browserOwner&&browserOwner!==owner)return;if(!logged)return;
  if(busy)throw fail('Предыдущая команда ещё выполняется');
  busy=true;try{const r=await request('logout',IDENTITY);if(r.result!==1)throw fail('Oktell не подтвердил отключение',502);disconnected();}finally{busy=false;}
 }
 return {read,command,activeUsers,disconnected,prepare,release,isActive:()=>busy||logged||!!browserOwner};
};
