import {z} from 'zod';
import {sessionEmployee,trustedOrigin} from '@/lib/auth';
import {db} from '@/lib/db';
import {readLimitedText,BodyTooLarge} from '@/lib/request-body';
import {nativeSettingsEnabled} from '@/lib/oktell-settings-native';
import {applyNativeProject,readNativeProject} from '@/lib/oktell-project-apply';
export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
async function allowed(req:Request){const a=await sessionEmployee(req.headers);return a?.role==='admin'&&!a.impersonation;}
function failure(e:unknown){
 if(e instanceof z.ZodError||e instanceof SyntaxError)return json({error:'Некорректные параметры проекта.'},400);
 if(e instanceof BodyTooLarge)return json({error:e.message},413);
 if(e instanceof Error&&'status' in e)return json({error:e.message},Number(e.status));
 return json({error:'Не удалось подтвердить настройки. Повторите проверку операции.'},503);
}
export async function GET(req:Request){
 if(!nativeSettingsEnabled())return json({error:'Применение настроек Oktell выключено.'},410);
 if(!await allowed(req))return json({error:'Нет доступа'},403);
 try{return json(await readNativeProject(db(),z.string().uuid().parse(new URL(req.url).searchParams.get('id'))));}catch(e){return failure(e);}
}
export async function POST(req:Request){
 if(!nativeSettingsEnabled())return json({error:'Применение настроек Oktell выключено.'},410);
 if(!await allowed(req)||!trustedOrigin(req.headers))return json({error:'Нет доступа'},403);
 try{return json(await applyNativeProject(db(),JSON.parse(await readLimitedText(req,4096))));}catch(e){return failure(e);}
}
