import type {Employee} from './crm';
import {payrollVisible,type PayrollRow} from './premium-ledger';
export function premiumStatistics(actor:Employee,periods:{id:string;status:string;rows:PayrollRow[]}[]){
 const result=new Map<string,{id:string;login:string;name:string;department:string;role:string;volume:number;first:number|null;second:number|null;total:number}>();
 for(const p of periods)for(const row of p.rows.filter(r=>payrollVisible(actor,r))){
  const id=row.employeeId||row.id;
  const value=result.get(id)||{id,login:row.login,name:row.name,department:row.department,role:row.role,volume:0,first:null,second:null,total:0};
  const payout=row.payout===null?null:Math.round((row.payout+row.input.official)*100)/100;
  if(p.id.endsWith('-1'))value.first=payout;else value.second=payout;
  if(row.role==='operator')value.volume=Math.round((value.volume+row.volume)*100)/100;
  value.total=Math.round(((value.first||0)+(value.second||0))*100)/100;
  result.set(id,value);
 }
 return [...result.values()];
}
