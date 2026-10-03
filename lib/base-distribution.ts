// Dates are calendar dates in Moscow; timestamps stay in UTC.
export const moscowDate=(now=new Date())=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Moscow',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
export function workDate(date:string,days:number){const d=new Date(date+'T12:00:00Z');while(days>0){d.setUTCDate(d.getUTCDate()+1);if(d.getUTCDay()!==0&&d.getUTCDay()!==6)days--;}return d.toISOString().slice(0,10);}
export function distributionEligible(client:{owner?:string;releasedAt?:string},today:string){return !client.owner&&(!client.releasedAt||workDate(moscowDate(new Date(client.releasedAt)),2)<=today);}
export function normalizedPhone(value:unknown){let n=String(value??'').trim().replace(/[\s()+.\-]/g,'');if(/^8\d{10}$/.test(n))n='7'+n.slice(1);return /^7\d{10}$/.test(n)?n:'';}
export function repeatSales(orders:{clientId:string;manager:string;status:string;redeemedAt?:string}[],from:string,to:string){
 const counts=new Map<string,Map<string,number>>();
 for(const o of orders){if(o.status!=='redeemed'||!o.redeemedAt)continue;const date=moscowDate(new Date(o.redeemedAt));if(date<from||date>to)continue;const clients=counts.get(o.manager)||new Map<string,number>();clients.set(o.clientId,(clients.get(o.clientId)||0)+1);counts.set(o.manager,clients);}
 return Object.fromEntries([...counts].map(([id,clients])=>{const values=[...clients.values()],unique=clients.size,repeats=values.reduce((n,v)=>n+v-1,0),repeatClients=values.filter(v=>v>1).length;return [id,{clients:unique,repeats,repeatClients,percent:Math.round(repeats/unique*1000)/10,coverage:Math.round(repeatClients/unique*1000)/10}];}));
}
export function previousThreeMonths(now=new Date()){const day=moscowDate(now),end=new Date(day.slice(0,7)+'-01T12:00:00Z');end.setUTCDate(0);const start=new Date(day.slice(0,7)+'-01T12:00:00Z');start.setUTCMonth(start.getUTCMonth()-3);return {from:start.toISOString().slice(0,10),to:end.toISOString().slice(0,10)};}
export function retentionDays(policy:{mode:string;days:number;defaultWeeks:number;bands:{maxPercent:number;weeks:number}[]}|undefined,percent=0){if(!policy)return 35;if(policy.mode==='fixed')return policy.days;const rounded=Math.round(percent*10)/10;return (policy.bands.find(b=>rounded<=b.maxPercent)?.weeks??policy.defaultWeeks)*7;}
