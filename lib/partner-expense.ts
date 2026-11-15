import {z} from 'zod';
import {db} from './db';
import {partnerAccountView} from './partner-account';
import {premiumPeriods} from './premium-periods';
import {defaultPartnerSettings,type PartnerSettings,isEmil} from './partner-cash';
import type {Employee} from './crm';
const schema=z.object({action:z.enum(['expense_add','expense_remove']),id:z.string().uuid(),period:z.string(),revision:z.string(),name:z.string().trim().min(1).max(200).optional(),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),amount:z.number().finite().positive().max(100000000).multipleOf(.01).optional()});
export async function partnerExpense(actor:Employee,body:unknown){
 const b=schema.parse(body),d=db();if(actor.role!=='admin'&&!isEmil(actor))throw Error('Нет доступа');
 const v=await partnerAccountView(b.period),calendar=premiumPeriods.find(p=>p.id===b.period);
 if(!v.account||!calendar||b.period<v.config.startPeriod||b.period!==v.state.ledger!.activePeriod||v.state.ledger!.periods[b.period].status==='paid')throw Error('Расходы изменяются только в текущем незакрытом периоде');
 const key='partner-cash:'+b.period,old=await d.prepare('SELECT data FROM settings WHERE id=?').bind(key).first<{data:string}>();
 const settings:PartnerSettings=old?JSON.parse(old.data):{...defaultPartnerSettings,taxRate:v.config.taxRate,bank:v.config.bank??0};
 const expenses=settings.expenses||[],existing=expenses.find(e=>e.id===b.id);
 if(b.action==='expense_add'&&existing||b.action==='expense_remove'&&existing?.removedAt)return;
 if(b.revision!==settings.revision)throw Error('Данные изменились. Обновите кассу');
 const at=new Date().toISOString(),today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date());
 let amount:number,name:string,date:string;
 if(b.action==='expense_add'){
  if(!b.name||!b.amount||!b.date||b.date<calendar.from||b.date>calendar.cutoff||b.date>today||new Date(b.date+'T12:00:00Z').toISOString().slice(0,10)!==b.date)throw Error('Укажите название, сумму и дату расхода внутри периода');
  amount=Math.round(b.amount*100);name=b.name;date=b.date;expenses.push({id:b.id,name,date,amount,at,by:actor.id});
 }else{
  if(!existing)throw Error('Расход не найден');amount=existing.amount;name=existing.name;date=today;existing.removedAt=at;existing.removedBy=actor.id;
 }
 const raw=JSON.stringify({...settings,expenses,revision:crypto.randomUUID()});
 const guard="COALESCE((SELECT data FROM settings WHERE id=?),'')=? AND EXISTS(SELECT 1 FROM settings WHERE id='premium-ledger' AND data=?) AND COALESCE((SELECT data FROM settings WHERE id='partner-settlements'),'')=?";
 const update=d.prepare('INSERT INTO settings(id,data) SELECT ?,? WHERE '+guard+' ON CONFLICT(id) DO UPDATE SET data=excluded.data').bind(key,raw,key,old?.data||'',v.state.raw,v.stored?.data||'');
 const remove=b.action==='expense_remove';
 const movement=d.prepare('INSERT INTO cash_operations(id,kind,sender,recipient,amount,purpose,date,created_at,accepted_at,actor,sender_name,recipient_name) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM settings WHERE id=? AND data=?)').bind('partner-expense:'+b.period+':'+b.id+(remove?':reversal':''),remove?'add':'spend',remove?null:v.emil.id,remove?v.emil.id:null,amount,(remove?'Отмена расхода: ':'Разовый расход: ')+name+' · '+b.period,date,at,remove?at:null,actor.id,remove?'':v.emil.name,remove?v.emil.name:'',key,raw);
 const [result]=await d.batch([update,movement]);if(!result.meta.changes)throw Error('Данные изменились. Обновите кассу');
}
