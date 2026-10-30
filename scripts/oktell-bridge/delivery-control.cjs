'use strict';
const fs=require('node:fs');
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const fail=(message,status=409)=>Object.assign(Error(message),{status});
module.exports=function({request,connected,rememberDelivery=()=>{},load=()=>JSON.parse(fs.readFileSync(process.env.BRIDGE_PILOT||'/etc/sm-oktell-bridge/pilot.json','utf8'))}){
 function task(){const id=load()?.taskId;if(!uuid(id))throw fail('Проект Oktell не настроен',503);return id.toLowerCase();}
 async function execute(procedure,inputparams){
  if(!connected())throw fail('Нет связи с Oktell',503);
  const r=await request('execpredefineddbstoredproc',{procedure,inputparams});
  if(r.result!==1)throw fail('Oktell не подтвердил операцию: '+String(r.errorstr||'нет результата').slice(0,300),502);
  if(!Array.isArray(r.dataset)||r.dataset.length!==1||!Array.isArray(r.dataset[0])||r.dataset[0].length!==2||!Array.isArray(r.dataset[0][0])||!Array.isArray(r.dataset[0][1]))throw fail('Неполный ответ источника Oktell',502);
  return Object.fromEntries(r.dataset[0][0].map((key,i)=>[key,r.dataset[0][1][i]]));
 }
 function receipt(r,id,taskId){
  if(String(r.BatchId).toLowerCase()!==id.toLowerCase()||String(r.TaskId).toLowerCase()!==taskId||!Number.isInteger(r.Accepted)||r.Accepted<1||r.Accepted>1000||!/^[a-f0-9]{64}$/.test(r.Fingerprint)||![0,1,false,true].includes(r.Cancelled))throw fail('Подтверждение Oktell не соответствует загрузке',502);
  return {id:id.toLowerCase(),taskId,fingerprint:r.Fingerprint,accepted:r.Accepted,cancelled:!!r.Cancelled};
 }
 async function state(){
  const taskId=task(),r=await execute('w_crm_delivery_state',{task:taskId});
  if(String(r.TaskId).toLowerCase()!==taskId||!uuid(r.ListId)||!uuid(r.TaskListId)||![0,1].includes(r.Active)||![0,1].includes(r.Done)||![0,1].includes(r.SourcePresent)||![r.Contacts,r.Sessions].every(n=>Number.isSafeInteger(n)&&n>=0))throw fail('Некорректное состояние источника Oktell',502);
  return {taskId,taskName:String(r.TaskName),sourceListId:r.ListId.toLowerCase(),taskListId:r.TaskListId.toLowerCase(),sourcePresent:!!r.SourcePresent,sourceAttached:r.ListId.toLowerCase()===r.TaskListId.toLowerCase(),paused:r.Active===0&&r.Done===0,contacts:r.Contacts,sessions:r.Sessions};
 }
 async function importBatch(b){
  if(!b||Object.keys(b).some(k=>!['taskId','id','fingerprint','items'].includes(k))||!uuid(b.taskId)||!uuid(b.id)||!/^[a-f0-9]{64}$/.test(b.fingerprint)||!Array.isArray(b.items)||b.items.length<1||b.items.length>1000)throw fail('Некорректная партия клиентов',400);
  if(b.items.some(c=>!c||Object.keys(c).some(k=>!['clientId','phone','name'].includes(k))||!/^C-[a-zA-Z0-9-]{1,78}$/.test(c.clientId)||typeof c.phone!=='string'||!/^7\d{10}$/.test(c.phone)||typeof c.name!=='string'||c.name.length>200)||new Set(b.items.map(c=>c.clientId)).size!==b.items.length||new Set(b.items.map(c=>c.phone)).size!==b.items.length)throw fail('Проверьте клиентов и номера в партии',400);
  const taskId=task();if(b.taskId.toLowerCase()!==taskId)throw fail('Проект изменился; требуется сверка загрузки');const r=receipt(await execute('w_crm_delivery_import',{task:taskId,batch:b.id,fingerprint:b.fingerprint,payload:JSON.stringify(b.items)}),b.id,taskId);
  if(r.accepted!==b.items.length||r.fingerprint!==b.fingerprint)throw fail('Oktell подтвердил другой состав партии',502);
  rememberDelivery(r,b.items);
  return r;
 }
 async function cancel(b){if(!b||Object.keys(b).some(k=>!['id','taskId'].includes(k))||!uuid(b.taskId)||!uuid(b.id))throw fail('Некорректная загрузка',400);const taskId=task();if(b.taskId.toLowerCase()!==taskId)throw fail('Проект изменился; требуется сверка загрузки');const r=receipt(await execute('w_crm_delivery_cancel',{task:taskId,batch:b.id}),b.id,taskId);if(!r.cancelled)throw fail('Отмена не подтверждена Oktell',502);rememberDelivery(r);return r;}
 return {state,importBatch,cancel};
};
