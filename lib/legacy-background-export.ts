import {sessionEmployee} from './auth';
import {db} from './db';
import {queueExport,authorizedExport,exportWorkerHealthy,type ExportKind} from './export-jobs';
import {readExportFile} from './export-files';
// Old links keep returning XLSX on success, but no longer render it in the HTTP process.
export async function legacyBackgroundExport(req:Request,kind:ExportKind,parameter:string){
 if(process.env.CRM_EXPORT_WORKER!=='1')return;
 const actor=await sessionEmployee(req.headers);if(!actor)return Response.json({error:'Требуется вход'},{status:401});
 if(!await exportWorkerHealthy(db()))return Response.json({error:'Исполнитель выгрузок недоступен'},{status:503});
 const job=await queueExport(db(),actor,kind,parameter,crypto.randomUUID()),deadline=Date.now()+20000;
 while(Date.now()<deadline){
  const current=await authorizedExport(db(),actor,job.id);
  if(!current||current.state==='failed')return Response.json({error:'Не удалось подготовить выгрузку'},{status:400});
  if(current.state==='ready')return new Response(await readExportFile(job.id,current.claim),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${kind}-${parameter}.xlsx"`,'Cache-Control':'no-store'}});
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 return Response.json({error:'Выгрузка ещё готовится. Используйте кнопку Excel в CRM.',id:job.id},{status:503,headers:{'Retry-After':'5'}});
}
