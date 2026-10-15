import {initReplacement,confirmReplacementCourier} from '@/lib/phone-replacement';
import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {syncRedemption,redemptionRows,redemptionConfig,editRedemption,canSeeRedemption,awaitingReturn,awaitingDateConfirmation,inWorkday,dayOf,closedTime} from '@/lib/redemption';
import {cdekStatuses} from '@/lib/cdek-statuses';
import {skorozvonToken} from '@/lib/skorozvon';
export const dynamic='force-dynamic';
async function actor(){const e=(await getChatGPTUser())?.employee;if(!e)throw Error('Требуется вход');return e;}
export const GET=authenticated(async req=>{try{
 const e=await actor(),d=db();await syncRedemption(d);const cfg=await redemptionConfig(d),q=new URL(req.url).searchParams;
 if(q.has('projects')){if(e.role!=='admin')return Response.json({error:'Недостаточно прав'},{status:403});const credentials=await d.prepare("SELECT data FROM settings WHERE id='skorozvon'").first<{data:string}>();if(!credentials)throw Error('Сначала подключите Скорозвон в интеграциях');const token=await skorozvonToken(JSON.parse(credentials.data));const projects=[];for(let page=1;page<=100;page++){const r=await fetch('https://api.skorozvon.ru/api/v2/call_projects?length=100&page='+page,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Не удалось получить проекты СК');const data=await r.json() as any,part=Array.isArray(data)?data:data.data;if(!Array.isArray(part))throw Error('Неожиданный ответ СК');projects.push(...part.map((p:any)=>({id:String(p.id),title:p.title})));if(part.length<100)break;}return Response.json({projects});}
 const all=await redemptionRows(d),archives=(await d.prepare('SELECT day,at FROM redemption_archives ORDER BY day DESC').all()).results;
 const confirmation=q.get('tab')==='confirm',returns=q.get('tab')==='returns';if((confirmation||returns)&&!['admin','redemption'].includes(e.role))return Response.json({error:'Access denied'},{status:403});
 let rows=all;if(returns)rows=all.filter(awaitingReturn);else if(confirmation)rows=all.filter(awaitingDateConfirmation);else if(q.get('archive')){const a=await d.prepare('SELECT data FROM redemption_archives WHERE day=?').bind(q.get('archive')).first<{data:string}>();rows=JSON.parse(a?.data||'[]');}
 else if(!q.get('id'))rows=all.filter((r:any)=>!awaitingReturn(r)&&r.result!=='returned'&&!awaitingDateConfirmation(r)&&!(r.dateConfirmation==='confirmed'&&r.result==='date'&&r.resultDate>dayOf())&&(q.get('all')||inWorkday(r,dayOf())));
 rows=rows.filter((r:any)=>canSeeRedemption(e,r,cfg.headsAll)&&(!q.get('id')||r.order_id===q.get('id'))).map(({phone,...r}:any)=>r);
 const history=q.get('id')&&rows.length?(await d.prepare('SELECT at,data FROM redemption_history WHERE order_id=? ORDER BY id DESC').bind(q.get('id')).all()).results.map((r:any)=>({at:r.at,...JSON.parse(r.data)})):[];
 const matches=q.get('id')&&rows.length?(await d.prepare('SELECT day,at,data FROM redemption_archives ORDER BY day DESC').all()).results.flatMap((a:any)=>JSON.parse(a.data).filter((r:any)=>r.order_id===q.get('id')&&canSeeRedemption(e,r,cfg.headsAll)).map(({phone,...r}:any)=>({day:a.day,...r}))):[];
 const jobs=['admin','redemption'].includes(e.role)?(await d.prepare('SELECT day,state,error,updated_at FROM redemption_dispatch ORDER BY day DESC LIMIT 10').all()).results:[];
 let calls:any[]=[],courier=null;
 if(q.get('id')&&rows.length&&['admin','redemption'].includes(e.role)){
  await initReplacement(d);calls=(await d.prepare('SELECT c.*,a.number,a.released_at FROM replacement_calls c JOIN replacement_assignments a ON a.id=c.assignment_id WHERE c.order_id=? ORDER BY c.claimed_at DESC').bind(q.get('id')).all()).results;
  courier=await d.prepare('SELECT c.* FROM replacement_couriers c JOIN replacement_assignments a ON a.id=c.assignment_id WHERE a.order_id=? AND a.released_at IS NULL').bind(q.get('id')).first();
 }
 return Response.json({returnCount:['admin','redemption'].includes(e.role)?all.filter(awaitingReturn).length:0,confirmationCount:['admin','redemption'].includes(e.role)?all.filter(awaitingDateConfirmation).length:0,rows,archives,history,matches,config:cfg,day:dayOf(),closed:closedTime(),jobs,calls,courier});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Ошибка загрузки'},{status:400});}});
export const POST=authenticated(async req=>{try{const e=await actor(),d=db(),p=await req.json() as any;await syncRedemption(d);
 if(p.operation==='settings'){
  if(e.role!=='admin')throw Error('Настройки доступны администратору');
  const previous=await redemptionConfig(d);const statuses=Array.isArray(p.statuses)?p.statuses:[];
  if(statuses.some((s:any)=>!cdekStatuses.some(v=>v.code===s)))throw Error('Неизвестный статус');
  if(p.projectId&&!/^\d+$/.test(p.projectId))throw Error('Выберите проект СК');
  if(p.automatic&&!p.projectId)throw Error('Выберите проект СК');
  if(p.automatic&&String(p.projectId)==='50000192327')throw Error('Этот проект используется прежней Таблицей Выкуп. Выберите отдельный проект');
  const cfg={...previous,statuses:[...new Set(statuses)],projectId:p.projectId||'',automatic:!!p.automatic};
  await d.prepare("INSERT INTO settings(id,data) VALUES('redemption-config',?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(JSON.stringify(cfg)).run();await syncRedemption(d);
 }else if(p.operation==='heads'){
  if(e.role!=='redemption')throw Error('Переключатель доступен сотруднику выкупа');
  const cfg=await redemptionConfig(d);await d.prepare("INSERT INTO settings(id,data) VALUES('redemption-config',?) ON CONFLICT(id) DO UPDATE SET data=json_set(settings.data,'$.headsAll',json_extract(excluded.data,'$.headsAll'))").bind(JSON.stringify({...cfg,headsAll:!!p.value})).run();
 }else if(p.operation==='courier'){await confirmReplacementCourier(d,e,p.callId);}else {await editRedemption(d,e,p);}
 return Response.json({ok:true});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Ошибка сохранения'},{status:400});}});
