import {readLimitedText} from '@/lib/request-body';
import {z} from 'zod';
import {sessionEmployee,trustedOrigin} from '@/lib/auth';
import {db} from '@/lib/db';
import {pilotControl} from '@/lib/oktell-pilot-control';
import {readOktellFollowup} from '@/lib/oktell-followup';
import {deliverySelection,initOktellDelivery,previewOktellDelivery,reserveOktellDelivery,sendOktellDelivery,cancelOktellDelivery,completeOktellDelivery} from '@/lib/oktell-delivery';
export const dynamic='force-dynamic';
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('preview'),selection:deliverySelection}).strict(),
 z.object({action:z.literal('upload'),selection:deliverySelection,id:z.string().uuid(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
 z.object({action:z.literal('retry'),id:z.string().uuid()}).strict(),
 z.object({action:z.literal('cancel'),id:z.string().uuid()}).strict(),
 z.object({action:z.literal('complete'),id:z.string().uuid()}).strict(),
]);
export async function GET(req:Request){
 const actor=await sessionEmployee(req.headers);if(actor?.role!=='admin')return Response.json({error:'Нет доступа'},{status:403});
 try{
  const d=db();await initOktellDelivery(d);
  const jobs=(await d.prepare('SELECT j.*,COUNT(i.client_id) total FROM oktell_deliveries j LEFT JOIN oktell_delivery_items i ON i.job_id=j.id GROUP BY j.id ORDER BY j.created_at DESC LIMIT 20').all()).results.map((r:any)=>({...r,selection:JSON.parse(r.selection)}));
  let source=null,error='';try{source=await pilotControl('/delivery');}catch(e){error=e instanceof Error?e.message:'Нет связи с Oktell';}
  const page=z.coerce.number().int().min(0).max(100000).parse(new URL(req.url).searchParams.get('queuePage')||0);
  const followup=await readOktellFollowup(d,page);
  const imports=(await d.prepare('SELECT session,base,filename,MIN(created_at) created_at,COUNT(*) total FROM base_import_members GROUP BY session,base,filename ORDER BY created_at DESC LIMIT 100').all()).results;
  return Response.json({source,error,jobs,followup,imports},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось прочитать загрузки'},{status:502});}
}
export async function POST(req:Request){
 const actor=await sessionEmployee(req.headers);if(actor?.role!=='admin'||!trustedOrigin(req.headers))return Response.json({error:'Нет доступа'},{status:403});
 try{
  const raw=await readLimitedText(req,16000);if(raw.length>4000)return Response.json({error:'Слишком большой запрос'},{status:413});
  const b=command.parse(JSON.parse(raw)),d=db();
  if(b.action==='retry')return Response.json(await sendOktellDelivery(d,b.id));
  if(b.action==='complete')return Response.json(await completeOktellDelivery(d,b.id));
  if(b.action==='cancel')return Response.json(await cancelOktellDelivery(d,b.id));
  const source=await pilotControl('/delivery');
  if(source.taskId!==b.selection.taskId||source.sourcePresent!==true)throw Error('Источник проекта изменился или не настроен. Обновите данные.');
  if(!source.paused||source.sessions!==0)throw Error('Перед загрузкой приостановите проект и дождитесь завершения звонков.');
  if(b.action==='preview'){const {items,...preview}=await previewOktellDelivery(d,b.selection);return Response.json(preview);}
  await reserveOktellDelivery(d,actor.id,b.id,b.selection,b.fingerprint);
  return Response.json(await sendOktellDelivery(d,b.id));
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Проверьте параметры загрузки':e instanceof Error?e.message:'Не удалось выполнить загрузку'},{status:e instanceof z.ZodError?400:409});}
}
