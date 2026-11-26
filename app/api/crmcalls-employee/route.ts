import {z} from 'zod';
import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {skStaff} from '@/lib/sk-order-import';
import {managesWorkDepartment} from '@/lib/head-vacation';
import {readCRMCalls} from '@/lib/crmcalls-store';
import {crmcallsApi} from '@/lib/crmcalls';
import {readIncomingConfig,saveIncomingConfig} from '@/lib/crmcalls-incoming';

async function handle(req:Request){
 try{
  if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
  const url=new URL(req.url),p=req.method==='POST'?z.object({employeeId:z.string().min(1),name:z.string().trim().max(300),revision:z.string().max(100),actorId:z.string().optional()}).strict().parse(await req.json()):null;
  const employeeId=p?.employeeId||url.searchParams.get('employeeId'),staff=await skStaff(db());
  const actor=staff.find(e=>e.id===url.searchParams.get('actorId')),employee=staff.find(e=>e.id===employeeId);
  if(!actor||!employee||employee.role!=='operator'||!(actor.role==='admin'||managesWorkDepartment(actor,employee.department,staff)))return Response.json({error:'Карточка сотрудника недоступна'},{status:403});
  const config=await readIncomingConfig(db()),connection=await readCRMCalls(db());
  if(!config||!connection?.apiKey)throw Error('Сначала настройте подключение CRMCalls');
  const users=z.array(z.object({id:z.string(),name:z.string(),status:z.string()})).parse((await crmcallsApi(connection.apiKey)('/users')).data);
  const links=config.operators.filter(link=>link.employeeId===employeeId);
  if(links.length>1)throw Error('У сотрудника несколько связей CRMCalls. Требуется проверка администратора.');
  const selected=links[0]?.userId||'';
  const available=users.filter(u=>u.status==='active'&&!config.operators.some(link=>link.userId===u.id&&link.employeeId!==employeeId));
  if(!p)return Response.json({revision:config.revision,name:users.find(u=>u.id===selected)?.name||'',users:available.map(u=>({id:u.id,name:u.name}))});
  if(p.revision!==config.revision)throw Error('Настройки изменились. Откройте карточку заново.');
  const matches=available.filter(u=>u.name.trim()===p.name);
  const userId=p.name?(matches.find(u=>u.id===selected)?.id||(matches.length===1?matches[0].id:'')):'';
  if(p.name&&!userId)throw Error('Выберите точное ФИО свободного активного сотрудника CRMCalls из подсказок.');
  const result=await saveIncomingConfig(db(),{...config,operators:[...config.operators.filter(link=>link.employeeId!==employeeId),...(userId?[{userId,employeeId:employee.id}]:[])]},p.revision);
  return Response.json({revision:result.revision,name:users.find(u=>u.id===userId)?.name||''});
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Проверьте поля связи CRMCalls':e instanceof Error?e.message:'Не удалось сохранить связь'},{status:400});}
}
export const GET=authenticated(handle);
export const POST=authenticated(handle);
