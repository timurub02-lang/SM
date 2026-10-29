import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {readPremiumState,savePremiumLedger} from '@/lib/premium-store';
import {freezePeriod,signPeriod,payPeriod,reopenPeriod} from '@/lib/premium-ledger';
import {z} from 'zod';
export const dynamic='force-dynamic';
export const POST=authenticated(async(req:Request)=>{
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 try{
  const body=z.object({period:z.string(),revision:z.string(),action:z.enum(['freeze','sign','pay','reopen'])}).parse(await req.json());
  const s=await readPremiumState(body.period),actor=s.employees.find(e=>e.id===new URL(req.url).searchParams.get('actorId'));
  if(!actor||(body.action==='sign'?actor.role!=='department_head':actor.role!=='admin'))return Response.json({error:'Недостаточно прав'},{status:403});
  if(!s.ledger)throw Error('Сначала загрузите и сверьте исходную ведомость');
  if(s.ledger.revision!==body.revision)return Response.json({error:'Ведомость изменилась. Обновите расчёт.'},{status:409});
  const at=new Date().toISOString();
  const next=body.action==='reopen'?reopenPeriod(s.ledger,body.period,actor!.id,at):body.action==='freeze'?freezePeriod(s.ledger,body.period,s.orders,s.employees,s.adjustments,actor!.id,at):body.action==='sign'?signPeriod(s.ledger,body.period,actor!,at):payPeriod(s.ledger,body.period,actor!.id,at);
  if(next!==s.ledger)await savePremiumLedger(s,next,body.period);
  return Response.json({ok:true});
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Некорректное действие':e instanceof Error?e.message:'Ошибка ведомости'},{status:400});}
});
