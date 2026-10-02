import {z} from 'zod';
import type {Order} from './crm.ts';
const day=z.string().refine(v=>!v||/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v,'Проверьте дату');
export const routingRuleSchema=z.object({id:z.string().min(1).max(80),name:z.string().trim().min(1).max(120),enabled:z.boolean(),slot:z.number().int().min(1).max(4),from:day,to:day,departments:z.array(z.enum(['1','2','3','4','5'])).max(5),products:z.array(z.string().trim().min(1).max(255)).max(200),weekdays:z.array(z.number().int().min(1).max(7)).max(7),period:z.enum(['day','week','month','rule']),maxCount:z.number().int().min(1).max(1000000).nullable(),maxAmount:z.number().positive().max(1000000000).nullable()}).refine(r=>!r.from||!r.to||r.from<=r.to,'Окончание раньше начала');
export const routingSchema=z.object({enabled:z.boolean(),revision:z.string().max(80),rules:z.array(routingRuleSchema).max(100)}).refine(c=>new Set(c.rules.map(r=>r.id)).size===c.rules.length,'Повторяются правила');
export type RoutingConfig=z.infer<typeof routingSchema>;
export type RoutingRule=z.infer<typeof routingRuleSchema>;
export type RoutingAccount={slot:number;name:string;configured:boolean};
export type RoutingUsage={slot:number;createdAt:string;state:string;amountCents:number};
export type RoutingChoice={slot:number;reason:string;ruleId?:string;start?:string;end?:string;maxCount?:number|null;maxCents?:number|null};
export const mainRoutingProduct=(items:Order['items'])=>items.reduce<(typeof items)[number]|undefined>((best,item)=>!best||item.price>best.price?item:best,undefined);
export const routingAmount=(order:Pick<Order,'items'>)=>Math.round(order.items.reduce((s,i)=>s+i.price*i.quantity,0)*100);
const dateString=(date:Date)=>date.toISOString().slice(0,10);
export function routingWindow(rule:RoutingRule,now:Date){
 const date=new Date(now.getTime()+3*3600000);date.setUTCHours(0,0,0,0);
 let start='0001-01-01',end='9999-12-31';
 if(rule.period!=='rule'){
  if(rule.period==='week')date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
  if(rule.period==='month')date.setUTCDate(1);
  start=dateString(date);
  if(rule.period==='month')date.setUTCMonth(date.getUTCMonth()+1);else date.setUTCDate(date.getUTCDate()+(rule.period==='week'?7:1));
  end=dateString(date);
 }
 if(rule.from&&rule.from>start)start=rule.from;
 if(rule.to){const after=new Date(rule.to+'T00:00:00Z');after.setUTCDate(after.getUTCDate()+1);if(dateString(after)<end)end=dateString(after);}
 return {start:new Date(start+'T00:00:00+03:00').toISOString(),end:new Date(end+'T00:00:00+03:00').toISOString()};
}
export function chooseRouting(config:RoutingConfig,accounts:RoutingAccount[],order:Pick<Order,'items'>,department:string,usage:RoutingUsage[],now=new Date()):RoutingChoice|null{
 if(department==='5'){
  const candidates=accounts.filter(a=>a.configured&&/аскеров/i.test(a.name));
  if(candidates.length!==1)throw Error('СДЭК: для A_ должен быть подключён один аккаунт ИП Аскеров');
  return {slot:candidates[0].slot,reason:'Обязательное правило: A_ → ИП Аскеров'};
 }
 if(!config.enabled)return null;
 const today=dateString(new Date(now.getTime()+3*3600000)),weekday=(new Date(today+'T00:00:00Z').getUTCDay()+6)%7+1;
 const main=mainRoutingProduct(order.items),amount=routingAmount(order);
 for(const r of config.rules){
  if(!r.enabled||r.from&&today<r.from||r.to&&today>r.to||r.departments.length&&!r.departments.includes(department as '1')||r.weekdays.length&&!r.weekdays.includes(weekday)||r.products.length&&!r.products.some(p=>p.toLocaleLowerCase('ru')===main?.name.trim().toLocaleLowerCase('ru')))continue;
  if(!accounts.some(a=>a.slot===r.slot&&a.configured))throw Error(`СДЭК: аккаунт правила «${r.name}» не подключён`);
  const window=routingWindow(r,now),used=usage.filter(u=>u.slot===r.slot&&u.state!=='invalid'&&u.createdAt>=window.start&&u.createdAt<window.end);
  const maxCents=r.maxAmount===null?null:Math.round(r.maxAmount*100);
  if(r.maxCount!==null&&used.length+1>r.maxCount||maxCents!==null&&used.reduce((s,u)=>s+u.amountCents,0)+amount>maxCents)continue;
  return {slot:r.slot,reason:`${r.name}${r.products.length?` · главный товар: ${main!.name}`:''}`,ruleId:r.id,...window,maxCount:r.maxCount,maxCents};
 }
 throw Error('СДЭК: нет подходящего правила или лимиты исчерпаны. Обратитесь к администратору');
}

// Old shipments predate the frozen routing amount; use their order basket for those only.
export const shipmentAmountSql="COALESCE(json_extract(s.data,'$.routingAmountCents'),(SELECT ROUND(SUM(json_extract(i.value,'$.price')*json_extract(i.value,'$.quantity'))*100) FROM orders o,json_each(o.data,'$.items') i WHERE o.id=substr(s.id,15)),0)";
export function routingReservationGuard(route:{raw:string;managerRaw:string;amountCents:number;choice:RoutingChoice|null},order:Order){
 let sql="COALESCE((SELECT data FROM settings WHERE id='cdek-routing'),'')=? AND COALESCE((SELECT data FROM employees WHERE id=?),'')=?";
 const values:(string|number)[]=[route.raw,order.manager,route.managerRaw];const c=route.choice;
 if(c?.start&&c.end){
  sql+=' AND ?<=strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') AND strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\')<?';values.push(c.start,c.end);
  const where="s.id LIKE 'cdek-shipment-%' AND s.id<>? AND json_extract(s.data,'$.state')<>'invalid' AND json_extract(s.data,'$.slot')=? AND json_extract(s.data,'$.createdAt')>=? AND json_extract(s.data,'$.createdAt')<?";
  const args=[`cdek-shipment-${order.id}`,c.slot,c.start,c.end];
  if(c.maxCount!=null){sql+=` AND (SELECT COUNT(*) FROM settings s WHERE ${where})<?`;values.push(...args,c.maxCount);}
  if(c.maxCents!=null){sql+=` AND (SELECT COALESCE(SUM(${shipmentAmountSql}),0) FROM settings s WHERE ${where})+?<=?`;values.push(...args,route.amountCents,c.maxCents);}
 }
 return {sql,values};
}
