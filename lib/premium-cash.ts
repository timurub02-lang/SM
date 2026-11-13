import type {Employee} from './crm';
import type {PayrollRow,PayrollPeriod} from './premium-ledger';

// Use the signed snapshot, including its Н/СЗ flags and department owners.
export function premiumCashSpends(period:string,p:PayrollPeriod,employees:Pick<Employee,'id'|'cashDisabled'>[]=[]){
 if(p.status!=='paid'||!p.rows||!p.signers?.length||!p.paidAt||!p.paidBy)throw Error('Нет подписанной ведомости для списания ЗП');
 const amounts=new Map<string,number>();
 for(const row of p.rows){
  if(row.input.sz)continue;
  if(row.payout===null||!Number.isFinite(row.payout)||row.payout<0)throw Error('Не рассчитана выплата '+row.login);
  const heads=p.signers.filter(h=>h.department===row.department);
  if(heads.length!==1)throw Error('Не определена касса руководителя отдела '+row.department);
  amounts.set(heads[0].id,(amounts.get(heads[0].id)||0)+Math.round(row.payout*100));
 }
 return p.signers.filter(h=>!employees.some(e=>e.id===h.id&&e.cashDisabled)).flatMap(h=>{const amount=amounts.get(h.id)||0;return amount?[{id:'premium:'+period+':'+h.id,sender:h.id,senderName:h.name,amount,purpose:'ЗП · '+period,date:new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow'}).format(new Date(p.paidAt!)),at:p.paidAt!,actor:p.paidBy!}]:[];});
}

export type CashPayroll={period:string;rows:PayrollRow[]};
export function cashAfterPayroll(balance:number,department:string,rows:PayrollRow[]){
 const payable=rows.filter(r=>r.department===department&&!r.input.sz);
 if(!payable.length||payable.some(r=>r.payout===null||!Number.isFinite(r.payout)||r.payout<0))return null;
 const payout=payable.reduce((sum,r)=>sum+Math.round(r.payout!*100),0);
 return {payout,remaining:balance-payout};
}
