import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {db} from '@/lib/db';
import {ledgerKey,payrollVisible,type PremiumLedger} from '@/lib/premium-ledger';
import type {Employee} from '@/lib/crm';
import {premiumPeriods} from '@/lib/premium-periods';
export const dynamic='force-dynamic';
export const GET=authenticated(async(req:Request)=>{
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 const d=db(),actorRow=await d.prepare('SELECT data FROM employees WHERE id=?').bind(new URL(req.url).searchParams.get('actorId')||'').first<{data:string}>();
 const actor=actorRow?JSON.parse(actorRow.data) as Employee:null;
 if(!actor||!['admin','department_head','operator'].includes(actor.role))return Response.json({error:'Архив недоступен'},{status:403});
 const stored=await d.prepare('SELECT data FROM settings WHERE id=?').bind(ledgerKey).first<{data:string}>();
 const ledger=stored?JSON.parse(stored.data) as PremiumLedger:null;
 const periods=Object.entries(ledger?.periods||{}).filter(([,p])=>p.status==='paid').sort(([a],[b])=>b.localeCompare(a)).flatMap(([id,p])=>{
  const rows=(p.rows||[]).filter(r=>payrollVisible(actor,r)),visibleOrders=(p.orders||[]).filter(r=>payrollVisible(actor,r)),orders=visibleOrders.filter(r=>!r.historyOnly),historyOrders=visibleOrders.filter(r=>r.historyOnly);
  if(!rows.length&&!visibleOrders.length&&actor.role!=='admin')return [];
  return [{id,label:premiumPeriods.find(p=>p.id===id)?.label||id,paidAt:p.paidAt,source:p.source?.name,count:orders.length,payout:rows.reduce((n,r)=>n+Math.round((r.payout||0)*100),0)/100,orders,historyOrders}];
 });
 return Response.json({periods},{headers:{'Cache-Control':'no-store'}});
});
