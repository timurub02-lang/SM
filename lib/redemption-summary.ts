import {dayOf,initRedemption} from './redemption.ts';
import type {ActivityDb as Db} from './activity-store.ts';
export type RedemptionSummary={action?:string;result:string;date:string;author:string;at:string;workedToday:boolean};
export function summarizeRedemption(v:any,now=new Date()):RedemptionSummary{
 const day=dayOf(now),attempt=v.lastAttempt?.at;
 return {action:v.action,result:v.action||v.author?v.result||'':'',date:v.resultDate||'',author:v.author||'',at:v.days?.[v.lastDay]?.at||'',workedToday:!!v.days?.[day]||!!attempt&&dayOf(new Date(attempt))===day};
}
export async function readRedemptionSummaries(d:Db,orderIds:readonly string[],now=new Date()){
 await initRedemption(d);const allowed=new Set(orderIds),summary:Record<string,RedemptionSummary>={};
 const rows=await d.prepare('SELECT order_id,data FROM redemption_entries').all();
 for(const row of rows.results)if(allowed.has(row.order_id))summary[row.order_id]=summarizeRedemption(JSON.parse(row.data),now);
 return summary;
}
