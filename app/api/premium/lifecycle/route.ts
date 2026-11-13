import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {readPremiumState,savePremiumLedger} from '@/lib/premium-store';
import {ledgerRows,freezePeriod,signPeriod,payPeriod,reopenPeriod} from '@/lib/premium-ledger';
import {z} from 'zod';
export const dynamic='force-dynamic';
export const POST=authenticated(async(req:Request)=>{
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 try{
  const body=z.object({period:z.string(),revision:z.string(),action:z.enum(['freeze','sign','pay','reopen']),department:z.string().min(1).optional()}).parse(await req.json());
  const s=await readPremiumState(body.period),actor=s.employees.find(e=>e.id===new URL(req.url).searchParams.get('actorId'));
  if(!actor||(body.action==='sign'?actor.role!=='department_head':body.action==='reopen'?actor.role!=='admin'&&(actor.role!=='department_head'||!body.department||body.department!==actor.department):actor.role!=='admin'))return Response.json({error:'Недостаточно прав'},{status:403});
  if(!s.ledger)throw Error('Сначала загрузите и сверьте исходную ведомость');
  if(s.ledger.revision!==body.revision)return Response.json({error:'Ведомость изменилась. Обновите расчёт.'},{status:409});
  if(body.action==='freeze')throw Error('Отдельная фиксация не нужна. Сначала руководители подписывают расчёт, затем администратор закрывает период.');
  const at=new Date().toISOString();
  const prepared=body.action==='sign'&&s.ledger.periods[body.period]?.status==='open'?freezePeriod(s.ledger,body.period,s.orders,s.employees,s.adjustments,actor.id,at):structuredClone(s.ledger);
  if(body.action==='sign'&&!prepared.periods[body.period]?.signatures[actor.id])prepared.periods[body.period]={...prepared.periods[body.period],rows:ledgerRows(prepared,body.period,s.orders,s.employees,s.adjustments)};
  const next=body.action==='reopen'?reopenPeriod(s.ledger,body.period,actor!.id,at,body.department):body.action==='sign'?signPeriod(prepared,body.period,actor!,at):payPeriod(s.ledger,body.period,actor!.id,at);
  if(next!==s.ledger)await savePremiumLedger(s,next,body.period);
  return Response.json({ok:true});
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Некорректное действие':e instanceof Error?e.message:'Ошибка ведомости'},{status:400});}
});
