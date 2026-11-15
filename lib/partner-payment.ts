import {z} from 'zod';
import {db} from './db';
import {partnerAccountView} from './partner-account';
import {premiumPeriods} from './premium-periods';
import type {Employee} from './crm';
import type {PartnerSettlement} from './partner-settlements';
const input=z.object({action:z.enum(['pay','debt','opening']),id:z.string().uuid(),revision:z.string(),period:z.string(),kind:z.enum(['goods','communication','bank','tax','share1','share2']).optional(),amount:z.number().finite().min(0).max(100000000).multipleOf(.01).optional(),recipient:z.string().optional()});
export async function partnerPayment(actor:Employee,body:unknown){
 const b=input.parse(body),d=db();
 const ledger=await d.prepare("SELECT data FROM settings WHERE id='premium-ledger'").first<{data:string}>();if(!ledger)throw Error('Период не настроен');
 const v=await partnerAccountView(JSON.parse(ledger.data).activePeriod);
 if(!v.account)throw Error('Сначала администратор должен сохранить налог и расходы кассы');
 if(actor.role!=='admin'&&actor.id!==v.emil.id)throw Error('Нет доступа');
 if(v.settlements.entries.some(e=>e.id===b.id))return;
 if(v.settlements.revision!==b.revision)throw Error('Данные изменились. Обновите кассу');
 if(b.period<v.config.startPeriod||b.period>v.state.ledger!.activePeriod)throw Error('Период недоступен');
 const next=structuredClone(v.settlements);next.revision=crypto.randomUUID();
 const at=new Date().toISOString(),date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date());
 let entry:PartnerSettlement|null=null,purpose='',recipientName='';
 if(b.action==='opening'){
  if(actor.role!=='admin'||b.amount===undefined||v.settlements.entries.length)throw Error('Начальный остаток задаёт администратор до первых расчётов');
  next.opening=Math.round(b.amount*100);
 }else{
  const row=v.obligations.find(r=>r.period===b.period&&r.kind===b.kind);
  if(!row||row.remaining===null||row.remaining<=0)throw Error('Нет суммы к оплате');
  const calendar=premiumPeriods.find(p=>p.id===b.period);if(!calendar||date<=calendar.cutoff)throw Error('Расчёты доступны после окончания периода поступлений');
  const amount=Math.round((b.amount??0)*100);
  if(b.action==='pay'){
   if(!row.payable)throw Error('Доли выплачиваются после закрытия периода администратором');
   if(amount<=0||amount>row.remaining)throw Error('Сумма превышает остаток обязательства');
   if(amount>(row.kind==='tax'?v.balance:v.available??0))throw Error('Недостаточно средств с учётом резерва налога. Можно перенести в долг');
   if(row.transfer){const recipient=v.administrators.find(e=>e.id===b.recipient);if(!recipient)throw Error('Выберите администратора — получателя');recipientName=recipient.name;}
  }
  entry={id:b.id,period:b.period,kind:row.kind,action:b.action,amount:b.action==='pay'?amount:0,at,by:actor.id,...(b.action==='pay'&&row.transfer?{recipient:b.recipient}:{})};next.entries.push(entry);
  purpose=row.label+' · '+b.period;
 }
 const raw=JSON.stringify(next),guard="COALESCE((SELECT data FROM settings WHERE id='partner-settlements'),'')=? AND EXISTS(SELECT 1 FROM settings WHERE id='premium-ledger' AND data=?) AND COALESCE((SELECT data FROM settings WHERE id='partner-cash-account'),'')=? AND (SELECT json_group_array(json_array(id,data)) FROM (SELECT id,data FROM settings WHERE id LIKE 'partner-cash:%' ORDER BY id))=? AND (SELECT json_group_array(json_array(id,version)) FROM (SELECT id,version FROM orders ORDER BY id))=? AND (SELECT json_group_array(json_array(id,version)) FROM (SELECT id,version FROM employees ORDER BY id))=? AND (SELECT json_group_array(json_array(id,data)) FROM (SELECT id,data FROM settings WHERE id LIKE ? ORDER BY id))=?";
 const args=[v.stored?.data||'',v.state.raw,v.account?.data||'',v.costVersions,v.state.orderVersions,v.state.staffVersions,'premium-draft:'+v.state.ledger!.activePeriod+':%',v.state.draftVersions];
 const update=d.prepare("INSERT INTO settings(id,data) SELECT 'partner-settlements',? WHERE "+guard+" ON CONFLICT(id) DO UPDATE SET data=excluded.data").bind(raw,...args);
 const movements=entry?.action==='pay'?[d.prepare("INSERT INTO cash_operations(id,kind,sender,recipient,amount,purpose,date,created_at,accepted_at,actor,sender_name,recipient_name) SELECT ?,?,?,?,?,?,?,?,NULL,?,?,? WHERE EXISTS(SELECT 1 FROM settings WHERE id='partner-settlements' AND data=?)").bind(entry.id,entry.recipient?'transfer':'spend',v.emil.id,entry.recipient??null,entry.amount,purpose,date,at,actor.id,v.emil.name,recipientName,raw)]:[];
 const [result]=await d.batch([update,...movements]);if(!result.meta.changes)throw Error('Данные изменились. Обновите кассу');
}
