import type {Employee} from './crm.ts';
import {payrollVisible,type PayrollOrder} from './premium-ledger.ts';

export const paidHistoryKey='premium-paid-history';
export type PaidHistory={source:string;sha256:string;orders:{externalId:string;period:string}[]};
export type PaidHistoryResult=PayrollOrder&{period:string;source:string};
export function paidHistoryResults(history:PaidHistory|null,actor:Employee,orders:{id:string;externalId:string;manager:string}[],employees:Employee[]):PaidHistoryResult[]{
 const byOrder=new Map(orders.map(o=>[o.externalId,o])),staff=new Map(employees.map(e=>[e.id,e]));
 return (history?.orders||[]).flatMap(row=>{
  const order=byOrder.get(row.externalId),employee=order?staff.get(order.manager):undefined;
  const scope={employeeId:employee?.id,department:employee?.department||''};
  // An unmatched historical number is only visible to the administrator.
  if(!payrollVisible(actor,scope))return [];
  const [year,month,half]=row.period.split('-');
  const label=new Intl.DateTimeFormat('ru-RU',{month:'long',timeZone:'UTC'}).format(new Date(Date.UTC(Number(year),Number(month)-1,1)));
  return [{...scope,id:order?.id,externalId:row.externalId,login:employee?.login||'',amount:0,amountUnknown:true,historyOnly:true,period:label[0].toUpperCase()+label.slice(1)+' '+year+' · '+half+'-й период',source:history!.source}];
 });
}
