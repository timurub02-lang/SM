import type {partnerCalculation,PartnerSettings} from './partner-cash';
export const settlementLabels={goods:'Товар',communication:'Связь',bank:'Услуги банка',tax:'Налог',share1:'Доля 1 · Эмиль',share2:'Доля 2 · администратор'};
export type SettlementKind=keyof typeof settlementLabels;
export type PartnerSettlement={id:string;period:string;kind:SettlementKind;action:'pay'|'debt';amount:number;at:string;by:string;recipient?:string};
export type PartnerSettlements={revision:string;opening:number;entries:PartnerSettlement[]};
export const emptySettlements:PartnerSettlements={revision:'',opening:0,entries:[]};
export function partnerObligations(period:string,report:ReturnType<typeof partnerCalculation>,settings:PartnerSettings,settlements:PartnerSettlements,accepted:Set<string>,closed:boolean){
 const totals={goods:report.goods,communication:Math.round(settings.communication*100),bank:Math.round(settings.bank*100),tax:report.tax,share1:report.partnerShare===null?null:Math.max(0,report.partnerShare),share2:report.ourShare===null?null:Math.max(0,report.ourShare)};
 return (Object.keys(totals) as SettlementKind[]).map(kind=>{
  const entries=settlements.entries.filter(e=>e.period===period&&e.kind===kind),payments=entries.filter(e=>e.action==='pay');
  const sent=payments.reduce((sum,e)=>sum+e.amount,0),pending=payments.filter(e=>e.recipient&&!accepted.has(e.id)).reduce((sum,e)=>sum+e.amount,0);
  const total=totals[kind],remaining=total===null?null:Math.max(0,total-sent);
  return {period,kind,label:settlementLabels[kind],total,sent,pending,remaining,debt:entries.some(e=>e.action==='debt'),transfer:['goods','communication','share2'].includes(kind),payable:(!kind.startsWith('share')||closed)&&remaining!==null&&remaining>0};
 });
}
