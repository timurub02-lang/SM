import {authenticated} from '@/lib/api-auth';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {readPremiumState} from '@/lib/premium-store';
import {ledgerRows} from '@/lib/premium-ledger';
import {premiumStatistics} from '@/lib/premium-statistics';
export const dynamic='force-dynamic';
export const GET=authenticated(async(req:Request)=>{
 if(!await getChatGPTUser())return Response.json({error:'Требуется вход'},{status:401});
 try{
  const q=new URL(req.url).searchParams,month=q.get('month')||'';
  if(month&&!/^\d{4}-\d{2}$/.test(month))throw Error('Выберите месяц');
  const s=await readPremiumState(month+'-1'),actor=s.employees.find(e=>e.id===q.get('actorId'));
  if(!actor||!['admin','department_head'].includes(actor.role))return Response.json({error:'Недостаточно прав'},{status:403});
  if(!s.ledger)return Response.json({months:[],rows:[],periods:[]});
  const months=[...new Set(Object.keys(s.ledger.periods).slice().sort().map(id=>id.slice(0,7)))].reverse();
  const selected=month||s.ledger.activePeriod.slice(0,7),periods=[];
  for(const half of [1,2]){
   const id=selected+'-'+half,state=id===month+'-1'?s:await readPremiumState(id),p=state.ledger?.periods[id];
   if(!p)continue;
   periods.push({id,status:p.status,rows:ledgerRows(state.ledger!,id,state.orders,state.employees,state.adjustments)});
  }
  return Response.json({month:selected,months,periods:periods.map(({id,status})=>({id,status})),rows:premiumStatistics(actor,periods)},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Ошибка статистики'},{status:400});}
});
