import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {z} from 'zod';

const uuid=z.string().uuid();
export const nativeStateSchema=z.object({ok:z.literal(true),taskId:uuid,projectId:uuid,name:z.string(),active:z.number().int(),ringSeconds:z.number().int(),maxLines:z.number().int(),mode:z.enum(['preview','progressive','predictive']),snapshot:z.string().regex(/^[A-F0-9]{64}$/),schedule:z.array(z.object({day:z.number().int(),from:z.string(),to:z.string()})),assignedLines:z.number().int(),runtimeActivity:z.string()});
export type NativeProjectState=z.infer<typeof nativeStateSchema>;
export const nativeSettingsEnabled=()=>process.env.OKTELL_PROJECT_SETTINGS==='1'&&process.env.OKTELL_SETTINGS_NATIVE==='lab-vm105'&&!!process.env.OKTELL_SETTINGS_CREDENTIALS;
export const nativeError=(message:string,status=409)=>Object.assign(Error(message),{status});
const credentialsSchema=z.object({login:z.string().min(1),password:z.string().min(1),userId:uuid,helperMd5:z.string().regex(/^[A-F0-9]{32}$/)});
type Call=(method:string,args:Record<string,unknown>)=>Promise<any>;
const permitted=new Set(['getmyuserinfo','policy_getviewedprojects','projectcreateempty','scriptdownload','startsvcscript']);

// A separate authenticated session; never use or move the CRM's native bridge.
let queue:Promise<unknown>=Promise.resolve();
export function nativeSession<T>(work:(call:Call)=>Promise<T>):Promise<T>{
 const result=queue.then(()=>openSession(work));queue=result.catch(()=>{});return result;
}
async function openSession<T>(work:(call:Call)=>Promise<T>):Promise<T>{
 if(!nativeSettingsEnabled())throw nativeError('Подключение настроек к Oktell выключено.',503);
 const config=credentialsSchema.parse(JSON.parse(await readFile(process.env.OKTELL_SETTINGS_CREDENTIALS!,'utf8')));
 const socket=new WebSocket('ws://10.21.103.2:4055','json');
 const pending=new Map<string,{method:string;resolve:(x:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
 const fail=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(nativeError('Связь с Oktell прервалась. Результат операции нужно сверить.',503));}pending.clear();};
 socket.addEventListener('error',fail);socket.addEventListener('close',fail);
 const send=(method:string,args:Record<string,unknown>)=>socket.send(JSON.stringify([method,args]));
 socket.addEventListener('message',event=>{
  try{
   if(typeof event.data!=='string'||event.data.length>1048576)throw Error('Invalid frame');
   const [method,args]=JSON.parse(event.data);
   if(method==='whoareyou'){send('iam',{qid:args.qid,type:'web-client',name:'Lab project settings',version:1});return;}
   const p=pending.get(args?.qid);
   if(!p||method!==p.method+'result')return;
   clearTimeout(p.timer);pending.delete(args.qid);p.resolve(args);
  }catch{fail();socket.close();}
 });
 function command(method:string,args:Record<string,unknown>){return new Promise<any>((resolve,reject)=>{
  const qid=randomUUID(),timer=setTimeout(()=>{pending.delete(qid);reject(nativeError('Oktell не подтвердил результат. Повторите проверку этой операции.',503));socket.close();},15000);
  pending.set(qid,{method,resolve,reject,timer});
  try{send(method,{...args,qid,userlogin:config.login});}catch{clearTimeout(timer);pending.delete(qid);reject(nativeError('Нет подключения к Oktell.',503));}
 });}
 try{
  await new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>{socket.close();reject(nativeError('Oktell недоступен.',503));},8000);
   socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
   socket.addEventListener('error',()=>{clearTimeout(timer);reject(nativeError('Oktell недоступен.',503));},{once:true});
  });
  const hash=(s:string)=>createHash('md5').update(s).digest('hex').toUpperCase();
  const login=await command('login',{password:hash(config.password.toLowerCase()),Password:hash(config.password),expires:60,usewebrtc:0});
  if(login.result!==1)throw nativeError('Не удалось авторизовать учётную запись настроек.',503);
  const me=await command('getmyuserinfo',{});
  if(String(me.userid).toLowerCase()!==config.userId.toLowerCase()||me.hasline!==0)throw nativeError('Учётная запись настроек изменилась или занята телефоном.',503);
  const helper=await command('scriptdownload',{scriptid:'5e00bee1-41f3-42f7-9755-a28d6edeb7de'});
  if(helper.success!==true||helper.scriptname!=='CRM ALE41 Refresh Tasks'||helper.files?.find((f:any)=>f.name==='root.json'&&!f.subdirectory)?.md5!==config.helperMd5)throw nativeError('Сценарий применения изменён. Нужна проверка администратора.',503);
  return await work((method,args)=>{
   if(!permitted.has(method))throw nativeError('Команда не разрешена.',403);
   return command(method,args);
  });
 }finally{
  if(socket.readyState===WebSocket.OPEN){send('logout',{qid:randomUUID(),userlogin:config.login});socket.close();}
  else if(socket.readyState!==WebSocket.CLOSED)socket.close();
  fail();
 }
}

export async function nativeSettingsCall(call:Call,body:Record<string,unknown>):Promise<NativeProjectState>{
 const response=await call('startsvcscript',{scriptname:'CRM ALE41 Refresh Tasks',startparam1:JSON.stringify(body),waitresponse:true,waittimeoutsec:10});
 if(response.result!==1)throw nativeError('Oktell не подтвердил выполнение сценария. Проверьте результат операции.',503);
 let data:any;try{data=JSON.parse(response.returnvalue);}catch{throw nativeError('Oktell вернул неполное подтверждение. Проверьте результат операции.',503);}
 if(data?.ok!==true){
  const messages:Record<number,string>={51001:'Этот объект не относится к разрешённым лабораторным проектам.',51002:'Oktell отклонил параметры. Проверьте расписание и основные настройки.',51003:'Настройки заняты другой операцией. Повторите позже.',51004:'Задача больше не изолирована. Применение остановлено.',51005:'В Oktell работает задача. Обновление настроек отложено.',51006:'Настройки изменились. Загрузите состояние Oktell и сравните изменения.'};
  throw nativeError(messages[data?.code]||'Настройки не подтверждены Oktell.',data?.code===51001?403:409);
 }
 const parsed=nativeStateSchema.safeParse(data);
 if(!parsed.success||parsed.data.taskId.toLowerCase()!==String(body.taskId).toLowerCase()||parsed.data.projectId.toLowerCase()!==String(body.projectId).toLowerCase())throw nativeError('Ответ Oktell не соответствует проекту. Нужна сверка.',503);
 return parsed.data;
}
