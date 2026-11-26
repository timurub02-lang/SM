import {readIncomingConfig,incomingScenarios,incomingConfigSchema,incomingDashboard,saveIncomingConfig,runCRMCallsIncoming} from '@/lib/crmcalls-incoming';
import {z} from 'zod';
import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {crmcallsApi,crmcallsProjects,crmcallsScheduleSchema} from '@/lib/crmcalls';
import {crmcallsDashboard,initCRMCalls,previewCRMCalls,readCRMCalls,saveCRMCallsKey,saveCRMCallsSchedule} from '@/lib/crmcalls-store';

async function admin(req:Request){
 if(!await getChatGPTUser())return false;
 const row=await db().prepare('SELECT data FROM employees WHERE id=?').bind(new URL(req.url).searchParams.get('actorId')||'').first<{data:string}>();
 return !!row&&JSON.parse(row.data).role==='admin';
}
async function get(req:Request){
 if(!await admin(req))return Response.json({error:'CRMCalls доступен только администратору'},{status:403});
 try{
  if(new URL(req.url).searchParams.get('directory')==='1'){
   const c=await readCRMCalls(db());if(!c?.apiKey)throw Error('Сначала подключите API CRMCalls');
   const api=crmcallsApi(c.apiKey),scenario=new URL(req.url).searchParams.get('scenarioId');
   if(scenario){z.uuid().parse(scenario);return Response.json({results:(await api('/scenarios/'+scenario+'/results')).data});}
   const [users,scenarios]=await Promise.all([api('/users'),api('/scenarios')]);return Response.json({users:users.data,scenarios:scenarios.data});
  }
  if(new URL(req.url).searchParams.get('incoming')==='1')return Response.json(await incomingDashboard(db()));
  if(new URL(req.url).searchParams.get('projects')==='1'){
   const c=await readCRMCalls(db());if(!c?.apiKey)throw Error('Подключите CRMCalls с помощью API-ключа');
   return Response.json({projects:await crmcallsProjects(crmcallsApi(c.apiKey))});
  }
  return Response.json(await crmcallsDashboard(db()));
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось загрузить CRMCalls'},{status:400});}
}
const input=z.discriminatedUnion('action',[
 z.object({action:z.literal('saveIncoming'),config:z.unknown(),revision:z.string().max(100)}),
 z.object({action:z.literal('retryIncoming')}),
 z.object({action:z.literal('connect'),apiKey:z.string().trim().max(500).regex(/^(crmc_live_[A-Za-z0-9_-]+)?$/),revision:z.string().max(100)}),
 z.object({action:z.literal('preview'),schedule:crmcallsScheduleSchema}),
 z.object({action:z.literal('save'),schedule:crmcallsScheduleSchema,revision:z.string().max(100)}),
 z.object({action:z.literal('reconcile'),batchId:z.uuid(),importId:z.uuid()}),
]);
async function post(req:Request){
 if(!await admin(req))return Response.json({error:'CRMCalls доступен только администратору'},{status:403});
 if(req.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Запрос отклонён'},{status:403});
 try{
  const p=input.parse(await req.json());await initCRMCalls(db());
  if(p.action==='saveIncoming'){
   const config=incomingConfigSchema.parse(p.config),old=await readIncomingConfig(db());
   if(config.enabled){
    const c=await readCRMCalls(db());if(!c?.apiKey)throw Error('Сначала подключите API CRMCalls');
    const api=crmcallsApi(c.apiKey),users=await api('/users');
    for(const scenario of incomingScenarios(config)){
     const results=await api('/scenarios/'+scenario.scenarioId+'/results');
     if(!Array.isArray(results.data)||!results.data.some((v:any)=>v.id===scenario.resultId))throw Error('Результат не найден в выбранном сценарии');
    }
    if(!Array.isArray(users.data)||config.operators.some(link=>!old?.operators.some(previous=>previous.userId===link.userId&&previous.employeeId===link.employeeId)&&!users.data.some((v:any)=>v.id===link.userId&&v.status==='active')))throw Error('Выберите действующих операторов CRMCalls');
   }
   return Response.json(await saveIncomingConfig(db(),config,p.revision));
  }
  if(p.action==='retryIncoming'){await runCRMCallsIncoming(db(),true);return Response.json(await incomingDashboard(db()));}
  if(p.action==='connect'){await saveCRMCallsKey(db(),p.apiKey,p.revision);return Response.json({message:'Подключение проверено. Автоматическая выгрузка включается отдельно в проекте.'});}
  if(p.action==='reconcile'){
   const c=await readCRMCalls(db());if(!c?.apiKey)throw Error('Сначала подключите CRMCalls');
   const batch=await db().prepare("SELECT project FROM crmcalls_batches WHERE id=? AND state='unknown'").bind(p.batchId).first<{project:string}>();if(!batch)throw Error('Отправка уже проверяется или не найдена');
   const result=(await crmcallsApi(c.apiKey)('/contacts/import/'+p.importId)).data;
   if(result?.project?.id!==batch.project)throw Error('Импорт относится к другому проекту');
   await db().batch([db().prepare("UPDATE crmcalls_batches SET state='submitted',import_id=?,error='' WHERE id=? AND state='unknown'").bind(p.importId,p.batchId),db().prepare("UPDATE crmcalls_items SET state='submitted' WHERE batch_id=? AND state='unknown' AND EXISTS(SELECT 1 FROM crmcalls_batches WHERE id=? AND state='submitted')").bind(p.batchId,p.batchId)]);
   return Response.json({message:'Импорт поставлен на сверку. Повторной отправки нет.'});
  }
  if(p.action==='preview'){const {rows,total,dailyCount,plan}=await previewCRMCalls(db(),p.schedule);return Response.json({count:rows.length,total,dailyCount,plan});}
  if(p.schedule.enabled){
   const c=await readCRMCalls(db());if(!c?.apiKey)throw Error('Сначала подключите CRMCalls');
   const project=(await crmcallsProjects(crmcallsApi(c.apiKey))).find(v=>v.id===p.schedule.projectId);
   if(!project||project.status==='finished')throw Error('Проект недоступен для загрузки');
  }
  const result=await saveCRMCallsSchedule(db(),p.schedule,p.revision);
  return Response.json({...result,message:p.schedule.enabled?'Расписание включено':'Настройки сохранены. Выгрузка выключена.'});
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Проверьте поля настроек':e instanceof Error?e.message:'Не удалось сохранить CRMCalls'},{status:400});}
}
export const GET=authenticated(get);
export const POST=authenticated(post);
