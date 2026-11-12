import {authenticated} from '@/lib/api-auth';
import {sessionEmployee} from '@/lib/auth';
import {db} from '@/lib/db';
import {queueExport,authorizedExport,exportWorkerHealthy,mayExport,type ExportKind} from '@/lib/export-jobs';
import {readExportFile} from '@/lib/export-files';
import {premiumPeriods} from '@/lib/premium-periods';
export const dynamic='force-dynamic';
const disabled=()=>Response.json({error:'Фоновая выгрузка ещё не включена',backgroundDisabled:true},{status:409});
export const POST=authenticated(async req=>{
 if(process.env.CRM_EXPORT_WORKER!=='1')return disabled();
 const actor=await sessionEmployee(req.headers);if(!actor)return Response.json({error:'Требуется вход'},{status:401});
 const body=await req.json() as {kind?:unknown;parameter?:unknown;requestKey?:unknown}|null;
 if(!body||typeof body!=='object')return Response.json({error:'Неверные параметры'},{status:400});
 const kind=body.kind as ExportKind;
 if(!['base','premium'].includes(kind)||!mayExport(actor,kind))return Response.json({error:'Недостаточно прав'},{status:403});
 if(typeof body.parameter!=='string'||typeof body.requestKey!=='string'||kind==='premium'&&!premiumPeriods.some(p=>p.id===body.parameter))return Response.json({error:'Неверные параметры'},{status:400});
 if(!await exportWorkerHealthy(db()))return Response.json({error:'Исполнитель выгрузок недоступен. Повторите позже.'},{status:503});
 try{const job=await queueExport(db(),actor,kind,body.parameter,body.requestKey);return Response.json({id:job.id,state:job.state},{status:202});}
 catch(error){return Response.json({error:error instanceof Error?error.message:'Не удалось создать выгрузку'},{status:400});}
});
export const GET=authenticated(async req=>{
 if(process.env.CRM_EXPORT_WORKER!=='1')return disabled();
 const actor=await sessionEmployee(req.headers);if(!actor)return Response.json({error:'Требуется вход'},{status:401});
 const q=new URL(req.url).searchParams,job=await authorizedExport(db(),actor,q.get('id')||'');
 if(!job)return Response.json({error:'Выгрузка недоступна'},{status:404});
 if(q.get('download')!=='1')return Response.json({id:job.id,state:job.state,error:job.error,createdAt:job.created_at,expiresAt:job.expires_at});
 if(job.state!=='ready')return Response.json({error:'Выгрузка ещё не готова'},{status:409});
 try{return new Response(await readExportFile(job.id,job.claim),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${job.kind}-${job.parameter}.xlsx"`,'Cache-Control':'no-store'}});}
 catch{return Response.json({error:'Файл недоступен. Создайте новую выгрузку.'},{status:410});}
});
