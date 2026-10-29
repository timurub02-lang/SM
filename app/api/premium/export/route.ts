import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {readPremiumState} from '@/lib/premium-store';
import {ledgerRows,periodOrders} from '@/lib/premium-ledger';
import {premiumPeriods} from '@/lib/premium-periods';
import {premiumWorkbook} from '@/lib/premium-export';
export const dynamic='force-dynamic';
export const GET=authenticated(async(req:Request)=>{
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 try{
  const q=new URL(req.url).searchParams,period=q.get('period')||'',calendar=premiumPeriods.find(p=>p.id===period);
  if(!calendar)return Response.json({error:'Выберите расчётный период'},{status:400});
  const s=await readPremiumState(period),actor=s.employees.find(e=>e.id===q.get('actorId'));
  if(!actor||!['admin','department_head'].includes(actor.role))return Response.json({error:'Недостаточно прав'},{status:403});
  if(!s.ledger)return Response.json({error:'Ведомость ещё не загружена'},{status:400});
  const ledger={...s.ledger,periods:{...s.ledger.periods,[period]:s.ledger.periods[period]||{status:'open' as const,signatures:{}}}};
  const book=await premiumWorkbook(actor,period,calendar.label,ledger.periods[period],ledgerRows(ledger,period,s.orders,s.employees,s.adjustments),periodOrders(ledger,period,s.orders,s.employees));
  return new Response(new Uint8Array(await book.xlsx.writeBuffer()),{headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="premium-${period}-${actor.role==='admin'?'all':'department'}.xlsx"`,'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось создать Excel'},{status:400});}
});
