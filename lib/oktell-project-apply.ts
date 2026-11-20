import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {nativeSession,nativeSettingsCall,nativeError} from './oktell-settings-native.ts';
import {projectSettingsSchema} from './oktell-project-settings.ts';
import {nativeSettingsDiff} from './oktell-settings-diff.ts';
type Database={prepare:(sql:string)=>any;batch:(statements:any[])=>Promise<any[]>};
const commandSchema=z.object({id:z.string().uuid(),revision:z.number().int().positive(),expected:z.string().regex(/^[A-F0-9]{64}$/).nullable(),action:z.enum(['apply','retry'])}).strict();
async function init(d:Database){await d.prepare('CREATE TABLE IF NOT EXISTS oktell_project_native(id TEXT PRIMARY KEY,project_id TEXT,creating INTEGER NOT NULL DEFAULT 1,pending TEXT,applied_revision INTEGER,state TEXT)').run();}
export async function readNativeProject(d:Database,id:string){
 await init(d);const binding=await d.prepare('SELECT * FROM oktell_project_native WHERE id=?').bind(id).first();
 if(!binding?.project_id)return {state:null,pending:!!binding,creating:!!binding};
 // An unconfirmed create may not have produced a task. Retry uses its durable command.
 if(!binding.state)return {state:null,pending:!!binding.pending,creating:false};
 const state=await nativeSession(call=>nativeSettingsCall(call,{action:'read',taskId:id,projectId:binding.project_id}));
 return {state,pending:!!binding.pending,creating:false,appliedRevision:binding.applied_revision};
}
export async function applyNativeProject(d:Database,raw:unknown){
 const request=commandSchema.parse(raw);await init(d);
 const draft=await d.prepare('SELECT revision,settings FROM oktell_project_drafts WHERE id=?').bind(request.id).first();
 if(!draft)throw nativeError('Сначала сохраните черновик.',404);
 if(request.action==='apply'&&draft.revision!==request.revision)throw nativeError('Черновик изменён в другом окне. Загрузите актуальную версию.');
 const settings=projectSettingsSchema.parse(JSON.parse(draft.settings));
 if(request.action==='apply'&&(settings.timezone!=='Europe/Moscow'||settings.schedule.length===0))throw nativeError('Для применения задайте непустое расписание по Москве.');
 if(request.action==='apply'&&settings.mode==='preview')throw nativeError('Режим предварительного просмотра пока сохраняется только в черновике. Для native-применения доступны progressive и predictive.');
 // Apply only capabilities proven against the native runtime. Other sections remain drafts.
 const basic={name:settings.name,mode:settings.mode,ringSeconds:settings.ringSeconds,maxLines:settings.maxLines,timezone:settings.timezone,schedule:settings.schedule};
 return nativeSession(async call=>{
  let binding=await d.prepare('SELECT * FROM oktell_project_native WHERE id=?').bind(request.id).first();
  if(!binding){
   if(request.action==='retry')throw nativeError('Нет предыдущей операции для проверки.');
   const inserted=await d.prepare('INSERT OR IGNORE INTO oktell_project_native(id) VALUES(?)').bind(request.id).run();
   if(inserted.meta?.changes!==1)throw nativeError('Создание уже выполняется. Повторите проверку.');
   // Persist uncertainty before sending a non-idempotent native project-create command.
   const created=await call('projectcreateempty',{name:'LAB_SETTINGS_'+request.id});
   const projectId=z.string().uuid().parse(created.id);
   await d.prepare('UPDATE oktell_project_native SET project_id=?,creating=0 WHERE id=? AND project_id IS NULL').bind(projectId,request.id).run();
   binding=await d.prepare('SELECT * FROM oktell_project_native WHERE id=?').bind(request.id).first();
  }else if(!binding.project_id){
   const inventory=await call('policy_getviewedprojects',{});
   const matches=(inventory.objects||[]).filter((p:any)=>p.name==='LAB_SETTINGS_'+request.id);
   if(matches.length!==1)throw nativeError('Создание проекта не подтверждено. Администратору нужно сверить список проектов Oktell; повторное создание заблокировано.');
   const projectId=z.string().uuid().parse(matches[0].id);
   await d.prepare('UPDATE oktell_project_native SET project_id=?,creating=0 WHERE id=? AND project_id IS NULL').bind(projectId,request.id).run();
   binding=await d.prepare('SELECT * FROM oktell_project_native WHERE id=?').bind(request.id).first();
  }
  if(binding.pending&&request.action!=='retry')throw nativeError('Предыдущая операция не подтверждена. Нажмите «Проверить предыдущую операцию».');
  if(request.action==='retry'&&!binding.pending)return {state:binding.state?await nativeSettingsCall(call,{action:'read',taskId:request.id,projectId:binding.project_id}):null,pending:false,creating:false,appliedRevision:binding.applied_revision};
  let payload=binding.pending;
  if(!payload){
   const operationId=randomUUID();
   payload=JSON.stringify({action:'save',taskId:request.id,projectId:binding.project_id,operationId,expected:request.expected,settings:basic,revision:draft.revision});
   const changed=await d.prepare('UPDATE oktell_project_native SET pending=? WHERE id=? AND pending IS NULL').bind(payload,request.id).run();
   if(changed.meta?.changes!==1)throw nativeError('Другая операция уже выполняется. Повторите проверку.');
  }
  try{
   const state=await nativeSettingsCall(call,JSON.parse(payload));
   if(state.active!==0||state.runtimeActivity!=='0'||state.assignedLines!==0)throw nativeError('Oktell не подтвердил остановленную изолированную задачу.',503);
   if(nativeSettingsDiff(JSON.parse(payload).settings,state).length)throw nativeError('Значения в Oktell не совпали с отправленными. Проверьте предыдущую операцию; применение не подтверждено.',503);
   const appliedRevision=JSON.parse(payload).revision;
   await d.prepare('UPDATE oktell_project_native SET state=?,applied_revision=?,pending=NULL WHERE id=? AND pending=?').bind(JSON.stringify(state),appliedRevision,request.id,payload).run();
   return {state,pending:false,creating:false,appliedRevision};
  }catch(e){
   // A confirmed rejection is safe to clear; a transport failure stays retryable with the same operation ID.
   if(e instanceof Error&&'status' in e&&[403,409].includes(Number(e.status)))await d.prepare('UPDATE oktell_project_native SET pending=NULL WHERE id=? AND pending=?').bind(request.id,payload).run();
   throw e;
  }
 });
}
