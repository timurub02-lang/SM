import {z} from 'zod';
import {sessionEmployee,trustedOrigin} from '@/lib/auth';
import {db} from '@/lib/db';
import {readLimitedText,BodyTooLarge} from '@/lib/request-body';
import {readProjectDrafts,readProjectHistory,saveProjectDraft} from '@/lib/oktell-project-store';
export const dynamic='force-dynamic';
function retired(){return Response.json({error:'Прежний раздел Oktell закрыт. Откройте раздел заново.',redirect:'/oktell'},{status:410,headers:{'Cache-Control':'no-store'}});}
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
async function allowed(req:Request){const actor=await sessionEmployee(req.headers);return actor?.role==='admin'&&!actor.impersonation?actor:null;}
function failure(e:unknown){
 if(e instanceof z.ZodError)return json({error:'Проверьте настройки проекта',issues:e.issues.map(i=>({path:i.path.join('.'),message:i.message}))},400);
 if(e instanceof BodyTooLarge)return json({error:e.message},413);
 if(e instanceof SyntaxError)return json({error:'Не удалось прочитать запрос'},400);
 if(e instanceof Error&&'status' in e)return json({error:e.message},Number(e.status));
 return json({error:'Не удалось сохранить или прочитать проект. Повторите позже.'},500);
}
export async function GET(req:Request){
 if(process.env.OKTELL_PROJECT_SETTINGS!=='1')return retired();
 if(!await allowed(req))return json({error:'Настройки доступны только администратору'},403);
 try{
  const d=db(),id=new URL(req.url).searchParams.get('history');
  if(id)return json({history:await readProjectHistory(d,z.string().uuid().parse(id))});
  const employees=(await d.prepare("SELECT e.id,e.data FROM employees e JOIN auth_accounts a ON a.employee_id=e.id WHERE a.enabled=1 ORDER BY e.id").all()).results;
  const operators=employees.flatMap((row:any)=>{const e=JSON.parse(row.data);return e.role==='operator'?[{id:row.id,name:String(e.name||e.login||row.id),linked:e.oktell?.status==='linked'}]:[];});
  return json({projects:await readProjectDrafts(d),operators,native:{connected:false,canApply:false,message:'Подключение редактора к Oktell ещё не настроено. Проекты сохраняются как черновики.'}});
 }catch(e){return failure(e);}
}
export async function POST(req:Request){
 if(process.env.OKTELL_PROJECT_SETTINGS!=='1')return retired();
 const actor=await allowed(req);if(!actor||!trustedOrigin(req.headers))return json({error:'Нет доступа'},403);
 try{return json({project:await saveProjectDraft(db(),actor.id,JSON.parse(await readLimitedText(req,65536)))});}catch(e){return failure(e);}
}
