import type {premiumCalculation,PremiumAdjustment} from './premium-calculation.ts';

type Row=Omit<ReturnType<typeof premiumCalculation>['rows'][number],'input'>&{input:PremiumAdjustment};
export function departmentTotals(rows:Row[]){
 const sum=(value:(r:Row)=>number)=>rows.reduce((total,r)=>total+Math.round(value(r)*100),0)/100;
 return {operators:rows.filter(r=>r.employee.role==='operator').length,
  volume:sum(r=>r.employee.role==='operator'?r.volume:0),commission:sum(r=>r.commission),salary:sum(r=>r.salary),
  vacation:sum(r=>r.input.vacation),official:sum(r=>r.input.official),debt:sum(r=>r.input.debt),penalty:sum(r=>r.input.penalty),extra:sum(r=>r.input.extra),
  normal:sum(r=>r.input.sz?0:r.payout||0),sz:sum(r=>r.input.sz?r.payout||0:0),total:sum(r=>r.payout||0),missing:rows.some(r=>r.result===null)};
}
