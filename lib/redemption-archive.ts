import type {ActivityDb} from './activity-store.ts';
import type {Employee} from './crm.ts';
import {actions,canSeeRedemption,dayOf,redemptionHeadScope,redemptionNdCount,results} from './redemption.ts';

import {isArchiveOrderNumber} from './order-search.ts';

export async function archiveOrderDays(db:ActivityDb,employee:Employee,number:string){
 if(!isArchiveOrderNumber(number))throw Error('Введите короткий или полный номер заказа');
 const suffix=/^\d+$/.test(number)?'%-'+number:null;
 const {results:matches}=await db.prepare(`
  SELECT a.day, item.value AS snapshot FROM redemption_archives a, json_each(a.data) item
  WHERE json_extract(item.value,'$.order_id') = ? COLLATE NOCASE OR json_extract(item.value,'$.order_id') LIKE ?
  ORDER BY a.day DESC, json_extract(item.value,'$.order_id')
 `).bind(number,suffix).all();
 const {headsAll}=redemptionHeadScope();
 return matches.flatMap(({day,snapshot}:{day:string;snapshot:string})=>{
  const row=JSON.parse(snapshot);
  if(!canSeeRedemption(employee,row,headsAll))return [];
  const nd=(redemptionNdCount(row,day)||1)+'НД';
  const transfer=row.operatorReturn;
  const comments=[...(row.comments||[])];
  if(transfer?.comment && !comments.some(c=>c.at===transfer.at && c.text===transfer.comment))
   comments.push({at:transfer.at,text:transfer.comment,author:transfer.author});
  if(transfer?.outcome)comments.push({at:transfer.resolvedAt,text:transfer.outcome,author:transfer.resolvedBy});
  return [{day,orderId:row.order_id,
   action:row.result==='delivered'?'СДЭК':row.action==='nd'?nd:actions[row.action as keyof typeof actions]||'—',
   result:row.result==='date'?(row.resultDate||'').split('-').reverse().join('.')||'—':
    row.result==='none'?nd:row.result==='returned'&&row.returnCheck?.state!=='verified'?'Ожидает проверки СДЭК':results[row.result as keyof typeof results]||'—',
   author:row.author||'—',comments:comments.filter(c=>c.text && Number.isFinite(Date.parse(c.at)) && dayOf(new Date(c.at))===day)
    .sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)).map(c=>({text:c.text,author:c.author||'',at:c.at}))}];
 });
}
